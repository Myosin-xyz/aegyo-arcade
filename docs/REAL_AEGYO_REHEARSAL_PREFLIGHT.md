# Real Aegyo restored-clone preflight

On 2026-09-12, a read-only preflight ran against the isolated restored Aegyo clone `aegyo_auth_rehearsal_20260912` in Railway project `a719c26e-33b9-4a1c-8759-d5401c1e181a`, environment `27e2f29a-5846-48f8-9727-694a97c36ef6`. The one-shot operator deployment `6ac98015-9c10-46d7-827e-0bd1bc09b787` exited with Railway status `SUCCESS`, but its final result line was unavailable in Railway deployment logs. The result below was independently reproduced through Railway SSH against the restored clone; it is not presented as observed output from the original script.

The verification used `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` and the temporary `aegyo_rehearsal_reader` role. The role had login access and durable `default_transaction_read_only=on`; it had no superuser, database-creation, role-creation, replication, or row-security-bypass privileges. The active transaction also reported read-only mode.

| Check | Independently verified value |
| --- | ---: |
| Application tables | 48 |
| Users | 52 |
| Sessions | 25 |
| Canonical normalized snapshot SHA-256 | `dcaccf592d0a5009a832fc865a4f9aebc19caadaf0a1bbec1d7ac6174537e238` |

The canonical snapshot was assembled and hashed inside the read-only connection. No user row, email, password hash, password, session value, or snapshot body was exported or printed. Aggregate database activity showed no remaining preflight connection after the one-shot deployment stopped.

No human password canary was supplied. The preflight therefore remains `canaryRequired: true` and `canaryVerified: false`. A designated human must provide the separately controlled canary through the guarded handoff before legacy-password compatibility can be accepted. This check did not freeze source writers, migrate any user, initialize the production Accounts schema, or authorize a real migration or authentication cutover.
