# Staging session expiry and revocation proof

This proof is restricted to the isolated `accounts-staging` environment and the
two named synthetic `@example.invalid` fixtures. It refuses other project,
environment, service, issuer, database, subject, and email combinations before
database mutation. It never changes passwords, verification, bans, schema, or
runtime configuration and never invokes email or Privy.

Run only while those fixtures are reserved from other staging work:

```sh
PATH="$PWD/services/accounts/.proof/runtime/node-v24.21.0-darwin-arm64/bin:$PATH" \
  ACCOUNTS_REVOCATION_PROOF_CONFIRM=reserved-synthetic-staging-only \
  node scripts/auth-proof/cross-app-staging-expiry-revocation.mjs
```

The script authenticates normally through the deployed Accounts sign-in UI; it
does not inject product cookies. Through Railway SSH to the staging PostgreSQL
service, it expires only the target identity's currently active Arcade and
Aegyo local sessions. Retained cookies must fail, Daebak's independently sealed
session must remain active, and normal provider SSO must renew both expired
local sessions. This is a forced database-expiry test. It proves the deployed
expiry predicates and renewal journey, while a natural wall-clock wait through
each full configured TTL remains a separate acceptance observation.

The second phase opens two provider sessions for the target and one for a
different synthetic control user. It calls the reviewed owner-only
`public.aegyo_revoke_user(target, false)` function after exact identity guards.
The target security version must advance by one, its provider session count must
be zero, its ban flag must remain false, and the control security version must
remain unchanged. Both target browsers must lose authorization in Arcade,
Aegyo, and Daebak within the 30-second cache bound plus network margin. The
control stays active, restored stale provider cookies cannot mint any product
session, and a final credential login restores the target fixture for later
proofs. Security epochs are never rolled back.

The sanitized report is written with mode `0600` to the ignored
`services/accounts/.proof/cross-app-expiry-revocation-report.json`. It contains
only check names, timing, booleans, and aggregate outcomes; credentials, cookies,
subjects, database URLs, and row data are omitted.

On 2026-09-12, the deployed Node 24.21 staging proof passed all four phases.
Cross-product operator invalidation was observed within the bounded polling
window, the unrelated synthetic user remained authorized, and the final fresh
login succeeded.
