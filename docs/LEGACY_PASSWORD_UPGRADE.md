# Legacy password modernization boundary

September 11, 2026. Accounts can verify Aegyo's tagged `SHA-256(password + pepper)` credentials, but it does not yet persist a modern Better Auth hash after first login. A race-safe upgrade appears feasible through the existing request before-hook. It remains disabled pending a decision about its security-event semantics and cross-device logout.

## Feasible guarded sequence

Better Auth 1.7.4's installed `/sign-in/email` handler reads the user and credential account, calls the configured password verifier with `{ password, hash }`, and then creates a session. Although that verifier lacks account identity, the existing request before-hook runs earlier with the submitted email/password and database access. It can perform this sequence without passing plaintext to PostgreSQL or replacing the maintained handler:

1. Read the exact credential account plus the user's `credentialVersion`, `securityVersion` and banned state.
2. If the stored hash is tagged legacy, verify the password with the scoped pepper and compute the maintained hash in Node.
3. Compare-and-swap `account.password` using the exact account ID, expected legacy hash, user ID, both expected versions and a non-banned condition.
4. Let `aegyo_credential_changed` treat the update as a security event. It advances both versions, records `passwordChangedAt`, and deletes existing IdP sessions.
5. Whether this request won or another request already modernized the credential, read a fresh user/version snapshot into the request context.
6. Continue into Better Auth. It rereads the account, verifies the submitted password against the current hash, and creates a session using the fresh snapshot.

No trigger bypass or schema change is required. The compare-and-swap must be one statement binding the exact account, old hash and user versions; separate check/update statements are insufficient.

## Race analysis

If reset wins before the compare-and-swap, the hash or version predicate fails and Better Auth rejects the old password against the reset hash. If reset wins after the upgrade but before Better Auth's reread, that reread rejects the old password. If reset wins after verification, its trigger advances the versions and the session trigger rejects the stale insertion.

Operator revocation or ban has the same protection. If it wins first, the version/banned predicate prevents the upgrade. If it wins after the fresh snapshot, the session trigger observes the later version or ban. Deletion prevents the update, makes the maintained reread fail, or blocks session insertion through referential integrity. None of these races may be handled by refreshing a snapshot after maintained password verification.

Two concurrent valid legacy logins can also be safe: one compare-and-swap wins; the other loses the old-hash predicate, rereads the new hash and fresh versions, and Better Auth verifies the same secret. An intervening reset or revocation still wins through the checks above.

These conclusions need dedicated pause-point PostgreSQL tests before enablement. Current reset/operator tests establish the downstream session guard, but do not implement or exercise the full before-hook sequence.

## Material tradeoff requiring a decision

The existing trigger cannot distinguish same-secret modernization from a password change. The first upgrade therefore advances `passwordChangedAt`, `credentialVersion` and `securityVersion`, invalidates IdP sessions on other devices, and advances security claims consumed by every client. The initiating login can continue with its fresh snapshot, but other signed-in products or devices must authenticate again. This is safe and bounded, but it is not a silent, session-preserving rehash.

The disposable PostgreSQL proof demonstrates that behavior: a successful legacy login currently leaves the tagged hash unchanged, while a subsequent guarded old-hash replacement increments both security versions and removes the login session. That evidence explains the UX/security event; it does not prove that all automatic modernization is infeasible.

A session-preserving rehash still needs a stronger semantic operation. Classifying hash shapes in the trigger, using a caller-controlled setting, or exposing a definer function that accepts only old/new hashes would weaken the database guard. Passing plaintext and the pepper into PostgreSQL adds an unnecessary credential-exposure boundary. Do not use those approaches.

## Enablement gate

Before enabling the guarded security-event design:

1. explicitly accept the one-time cross-device logout and reset-cutoff change for each upgraded account;
2. add pause-point tests for reset, ban, revocation, deletion and concurrent legacy logins around the update, fresh snapshot, maintained verification and session insertion;
3. prove wrong passwords never write, modern credentials never rewrite, and failures remain retryable;
4. keep password, pepper, hashes and database errors out of logs; and
5. repeat the pinned Linux PostgreSQL suite and real multi-client staging acceptance.

Legacy users can currently sign in seamlessly while `ACCOUNTS_LEGACY_PEPPER` remains available. Keep the pepper scoped and audited, and do not remove it until every legacy credential has been safely changed through recovery or a reviewed first-login upgrade. No production import, migration, Railway change, or real-user operation was performed.
