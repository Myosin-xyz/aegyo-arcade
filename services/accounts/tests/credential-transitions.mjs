import assert from "node:assert/strict";
import { createProofProvider } from "../src/proof-provider.mjs";

// All identities, credentials and database fault injection below are synthetic.
export async function proveCredentialTransitions(
  t,
  {
    database,
    config,
    auth,
    request,
    cookies,
    clients,
    transaction,
    authorize,
    exchange,
    operatorCookie,
  },
) {
  let sequence = 0;
  async function fixture() {
    const email = `transition-${++sequence}@example.invalid`;
    const password = "Synthetic-initial-password-123";
    const response = await request("/sign-up/email", {
      body: { name: "Credential transition fixture", email, password },
    });
    assert.equal(response.status, 200);
    return {
      id: (await response.json()).user.id,
      email,
      password,
      cookie: cookies(response),
    };
  }
  async function state(id) {
    return (
      await database.query(
        `
      SELECT u."credentialVersion", u."passwordChangedAt", a.password,
        ARRAY(SELECT s.id FROM "session" s WHERE s."userId"=u.id ORDER BY s.id) AS sessions
      FROM "user" u JOIN "account" a ON a."userId"=u.id
      WHERE u.id=$1 AND a."providerId"='credential'`,
        [id],
      )
    ).rows[0];
  }
  async function reset(f, provider = auth) {
    assert.equal(
      (
        await request("/request-password-reset", {
          provider,
          body: { email: f.email },
        })
      ).status,
      200,
    );
    const { token } = config.mailbox.filter((m) => m.user.id === f.id).at(-1);
    return request("/reset-password", {
      provider,
      body: { token, newPassword: "Synthetic-new-password-789" },
    });
  }
  async function oldCookieRejected(cookie) {
    for (const client of clients) {
      const callback = await authorize(transaction(client), cookie);
      assert.equal(callback.searchParams.get("error"), "login_required");
      assert.equal(callback.searchParams.has("code"), false);
    }
  }
  async function newPasswordWorks(f) {
    const response = await request("/sign-in/email", {
      body: { email: f.email, password: "Synthetic-new-password-789" },
    });
    assert.equal(response.status, 200);
    for (const client of clients)
      assert.ok(
        (
          await authorize(transaction(client), cookies(response))
        ).searchParams.get("code"),
      );
  }
  function barrier() {
    const entered = Promise.withResolvers();
    const released = Promise.withResolvers();
    let first = true;
    return {
      release: released.resolve,
      async wait() {
        if (!first) return;
        first = false;
        entered.resolve();
        await released.promise;
      },
      async reached(pendingRequest) {
        let timer;
        try {
          await Promise.race([
            entered.promise,
            pendingRequest.then(() => {
              throw new Error("Login completed before the test barrier");
            }),
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("Test barrier timed out")),
                5000,
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      },
    };
  }

  await t.test(
    "unproven password writers reject HTTP and server API calls without changing credentials",
    async () => {
      const f = await fixture();
      const before = await state(f.id);
      for (const [path, cookie, body] of [
        [
          "/change-password",
          f.cookie,
          {
            currentPassword: f.password,
            newPassword: "Changed-but-forbidden-123",
            revokeOtherSessions: true,
          },
        ],
        [
          "/set-password",
          f.cookie,
          { newPassword: "Changed-but-forbidden-123" },
        ],
        [
          "/admin/set-user-password",
          operatorCookie,
          { userId: f.id, newPassword: "Changed-but-forbidden-123" },
        ],
      ]) {
        assert.equal((await request(path, { cookie, body })).status, 404);
        assert.deepEqual(await state(f.id), before);
      }
      await assert.rejects(
        auth.api.changePassword({
          headers: new Headers({ cookie: f.cookie }),
          body: {
            currentPassword: f.password,
            newPassword: "Changed-but-forbidden-123",
          },
        }),
        (error) => error.body?.code === "USE_PASSWORD_RECOVERY",
      );
      await assert.rejects(
        auth.api.setUserPassword({
          headers: new Headers({ cookie: operatorCookie }),
          body: { userId: f.id, newPassword: "Changed-but-forbidden-123" },
        }),
        (error) => error.body?.code === "USE_PASSWORD_RECOVERY",
      );
      assert.deepEqual(await state(f.id), before);
      assert.equal((await reset(f)).status, 200);
      await newPasswordWorks(f);
    },
  );

  await t.test(
    "even operator profile updates cannot overwrite credential security state",
    async () => {
      const f = await fixture();
      assert.equal((await reset(f)).status, 200);
      const before = await state(f.id);
      for (const data of [
        { credentialVersion: 0 },
        { passwordChangedAt: null },
      ]) {
        const response = await request("/admin/update-user", {
          cookie: operatorCookie,
          body: { userId: f.id, data },
        });
        assert.equal(response.status, 403);
        assert.equal((await response.json()).code, "SECURITY_STATE_MANAGED");
        assert.deepEqual(await state(f.id), before);
      }
    },
  );

  await t.test(
    "a throwing post-reset hook cannot leave the old password or SSO sessions usable",
    async () => {
      const f = await fixture();
      const before = await state(f.id);
      const tx = transaction(clients[0]);
      const code = (await authorize(tx, f.cookie)).searchParams.get("code");
      const fault = createProofProvider({
        ...config,
        proofHooks: {
          afterCredentialCommit: async () => {
            throw new Error("Synthetic hook failure");
          },
        },
      }).auth;
      assert.equal((await reset(f, fault)).status, 500);
      const after = await state(f.id);
      assert.equal(after.credentialVersion, before.credentialVersion + 1);
      assert.ok(after.passwordChangedAt instanceof Date);
      assert.notEqual(after.password, before.password);
      assert.deepEqual(after.sessions, []);
      await oldCookieRejected(f.cookie);
      assert.notEqual((await exchange(tx, code)).status, 200);
      assert.notEqual(
        (
          await request("/sign-in/email", {
            body: { email: f.email, password: f.password },
          })
        ).status,
        200,
      );
      await newPasswordWorks(f);
      // Recover from an ambiguous failed response through a fresh, valid link.
      assert.equal((await reset(f)).status, 200);
      assert.equal(
        (await state(f.id)).credentialVersion,
        after.credentialVersion + 1,
      );
    },
  );

  await t.test(
    "failure during session deletion rolls back password, cutoff and version as one database statement",
    async () => {
      const f = await fixture();
      const before = await state(f.id);
      await database.query(`
      CREATE TABLE public.aegyo_proof_delete_fault (id text PRIMARY KEY);
      CREATE FUNCTION public.aegyo_proof_fail_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM public.aegyo_proof_delete_fault WHERE id=OLD."userId") THEN
          RAISE EXCEPTION 'synthetic_delete_failure';
        END IF;
        RETURN OLD;
      END; $$;
      CREATE TRIGGER aegyo_proof_fail_delete BEFORE DELETE ON public."session"
      FOR EACH ROW EXECUTE FUNCTION public.aegyo_proof_fail_delete();
    `);
      try {
        await database.query(
          "INSERT INTO aegyo_proof_delete_fault VALUES ($1)",
          [f.id],
        );
        assert.equal((await reset(f)).status, 500);
        assert.deepEqual(await state(f.id), before);
        for (const client of clients)
          assert.ok(
            (await authorize(transaction(client), f.cookie)).searchParams.get(
              "code",
            ),
          );
      } finally {
        await database.query(`
        DROP TRIGGER aegyo_proof_fail_delete ON public."session";
        DROP FUNCTION public.aegyo_proof_fail_delete();
        DROP TABLE public.aegyo_proof_delete_fault;
      `);
      }
      assert.equal((await reset(f)).status, 200);
      await oldCookieRejected(f.cookie);
      await newPasswordWorks(f);
    },
  );

  for (const checkpoint of [
    "afterPasswordVerification",
    "beforeSessionInsert",
  ]) {
    await t.test(
      `a reset on another provider instance wins over a login paused at ${checkpoint}`,
      async () => {
        const f = await fixture();
        const gate = barrier();
        const slow = createProofProvider({
          ...config,
          proofHooks: {
            [checkpoint]: async () => gate.wait(),
          },
        }).auth;
        const login = request("/sign-in/email", {
          provider: slow,
          body: { email: f.email, password: f.password },
        });
        try {
          await gate.reached(login);
          assert.equal((await reset(f)).status, 200);
        } finally {
          gate.release();
        }
        const response = await login;
        assert.equal(response.status, 401);
        const error = await response.json();
        assert.equal(error.code, "CREDENTIAL_CHANGED");
        assert.equal(error.token, undefined);
        assert.deepEqual((await state(f.id)).sessions, []);
        await oldCookieRejected(f.cookie);
        await newPasswordWorks(f);
      },
    );
  }

  await t.test(
    "overlapping logins retain their own credential snapshots",
    async () => {
      const first = await fixture();
      const second = await fixture();
      assert.equal((await reset(second)).status, 200); // Different credential versions.
      const gate = barrier();
      const overlap = createProofProvider({
        ...config,
        proofHooks: {
          afterPasswordVerification: async () => gate.wait(),
        },
      }).auth;
      const login = request("/sign-in/email", {
        provider: overlap,
        body: { email: first.email, password: first.password },
      });
      try {
        await gate.reached(login);
        const otherLogin = await request("/sign-in/email", {
          provider: overlap,
          body: { email: second.email, password: "Synthetic-new-password-789" },
        });
        assert.equal(otherLogin.status, 200);
        assert.equal((await otherLogin.json()).user.id, second.id);
      } finally {
        gate.release();
      }
      const response = await login;
      assert.equal(response.status, 200);
      assert.equal((await response.json()).user.id, first.id);
    },
  );
}
