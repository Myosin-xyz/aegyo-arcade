#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdir, open, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const [aegyoInput, outputInput, accountsRef = "HEAD"] = process.argv.slice(2);
if (!aegyoInput || !outputInput)
  throw new Error("usage: AEGYO_CHECKOUT PRIVATE_OUTPUT_DIR [ACCOUNTS_REF]");
const accounts = await realpath(new URL("../../..", import.meta.url).pathname);
const aegyo = await realpath(aegyoInput);
const output = resolve(outputInput);
const outputRelative = relative(
  join(accounts, "services/accounts/.proof"),
  output,
);
if (outputRelative.startsWith("..") || outputRelative.startsWith("/"))
  throw new Error("bundle_output_must_be_under_accounts_proof");
const git = (cwd, args) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const aegyoRef = "f27b14f0c35fd710726cb5e1394d17c99d4ec348";
if (git(aegyo, ["rev-parse", `${aegyoRef}^{commit}`]) !== aegyoRef)
  throw new Error("missing_aegyo_commit");
const accountCommit = git(accounts, ["rev-parse", accountsRef]);
await mkdir(dirname(output), { recursive: true, mode: 0o700 });
await mkdir(output, { mode: 0o700 });

async function copyTracked(repo, ref, source, destination) {
  const bytes = execFileSync("git", ["show", `${ref}:${source}`], {
    cwd: repo,
  });
  const path = join(output, destination);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const file = await open(path, "wx", 0o600);
  try {
    await file.write(bytes);
  } finally {
    await file.close();
  }
}
const accountFiles = git(accounts, [
  "ls-tree",
  "-r",
  "--name-only",
  accountCommit,
  "services/accounts",
])
  .split("\n")
  .filter(
    (path) =>
      path === "services/accounts/package.json" ||
      path === "services/accounts/package-lock.json" ||
      [
        "credential-guards.sql",
        "database-options.mjs",
        "legacy-import.mjs",
        "passwords.mjs",
        "provider-core.mjs",
      ].some((name) => path === `services/accounts/src/${name}`) ||
      [
        "check-runtime.mjs",
        "import-legacy.mjs",
        "migrate.mjs",
        "private-tcp-relay.mjs",
        "real-import-rehearsal-lib.mjs",
        "snapshot-aegyo-local-state.mjs",
        "validate-real-import-rehearsal.mjs",
        "verify-real-canary-signin.mjs",
        "verify-resume-clone.mjs",
      ].some((name) => path === `services/accounts/scripts/${name}`),
  );
for (const path of accountFiles)
  await copyTracked(
    accounts,
    accountCommit,
    path,
    path.replace("services/accounts/", "accounts/"),
  );
const aegyoFiles = [
  "prisma/schema.prisma",
  "prisma/migrations/20260911200000_add_shared_auth/migration.sql",
  "scripts/shared-auth/reconcile.mjs",
  "scripts/shared-auth/reconciliation-lib.mjs",
  "scripts/shared-auth/install-mappings.mjs",
  "scripts/shared-auth/mapping-installer-lib.mjs",
  "scripts/shared-auth/real-restore-operator.sh",
];
for (const path of aegyoFiles)
  await copyTracked(aegyo, aegyoRef, path, `aegyo/${path}`);
execFileSync(
  process.execPath,
  [
    "--input-type=module",
    "--eval",
    `const {buildReconciliation}=await import(process.argv[1]);
const hex=(c)=>c.repeat(64);
const local={version:1,evidenceVersion:2,users:[{id:'u',role:'user',linkedRecords:{Follow:['f']},linkedRecordDigests:{Follow:hex('a')}}],anonymousPollVotes:{ids:['p'],recordsDigest:hex('b')}};
const accounts={version:1,issuer:'https://accounts.example.test',subjects:['s']};
const mapping={version:1,pairs:[{localUserId:'u',subject:'s'}]};
const first=buildReconciliation(local,accounts,mapping).localSnapshotDigest;
local.users[0].linkedRecordDigests.Follow=hex('c');
if(buildReconciliation(local,accounts,mapping).localSnapshotDigest===first)throw new Error('bundled_reconciler_discards_row_evidence');
local.users[0].linkedRecordDigests.Follow=hex('a');local.anonymousPollVotes.recordsDigest=hex('d');
if(buildReconciliation(local,accounts,mapping).localSnapshotDigest===first)throw new Error('bundled_reconciler_discards_anonymous_poll_evidence');`,
    new URL(
      `file://${join(output, "aegyo/scripts/shared-auth/reconciliation-lib.mjs")}`,
    ).href,
  ],
  { stdio: "pipe" },
);
await copyTracked(
  accounts,
  accountCommit,
  "services/accounts/operator-aegyo/package.json",
  "aegyo/package.json",
);
await copyTracked(
  accounts,
  accountCommit,
  "services/accounts/operator-aegyo/package-lock.json",
  "aegyo/package-lock.json",
);
await copyTracked(
  accounts,
  accountCommit,
  "services/accounts/scripts/real-import-rehearsal-operator.sh",
  "operator.sh",
);
const dockerfile = `FROM node:24.21.0-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg openssl stunnel4 \\
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg \\
 && echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \\
 && apt-get update && apt-get install -y --no-install-recommends postgresql-client-18 \\
 && rm -rf /var/lib/apt/lists/*
WORKDIR /operator/accounts
COPY accounts/package.json accounts/package-lock.json ./
RUN npm ci && npm cache clean --force
COPY accounts/ ./
WORKDIR /operator/aegyo
COPY aegyo/package.json aegyo/package-lock.json ./
RUN npm ci && npm cache clean --force
COPY aegyo/ ./
RUN npx prisma generate
COPY --chmod=500 operator.sh /operator/operator.sh
RUN mkdir -p /operator/accounts/.proof /operator/aegyo/.proof && chown -R node:node /operator
USER node
ENTRYPOINT ["/operator/operator.sh"]
`;
const file = await open(join(output, "Dockerfile"), "wx", 0o600);
try {
  await file.write(dockerfile);
} finally {
  await file.close();
}
console.info(
  JSON.stringify({
    accountCommit,
    aegyoCommit: aegyoRef,
    files: accountFiles.length + aegyoFiles.length + 4,
  }),
);
