# Accounts production database provisioning proof

On 2026-09-12, an empty dedicated PostgreSQL service was provisioned in the existing Railway project and production environment. This operation did not connect the Accounts application, install a schema, create application/OAuth users, import member data, or expose PostgreSQL publicly.

| Resource | Verified value |
| --- | --- |
| Project | `aegyo-arcade` (`8229f87c-908d-426d-9562-4b01b0e89a50`) |
| Environment | `production` (`106dcc90-e997-4d59-86d3-5ba7e66470cd`) |
| Database service | `aegyo-accounts-postgres-production` (`c211f7d5-2fcb-4dc8-8c61-561b9dacd3cd`) |
| Volume | `aegyo-accounts-postgres-production-volume` (`432a597c-4b2c-442a-9eec-1d162f54d904`) |
| Volume instance | `9cd284d7-7d68-4240-8127-416aff8f4a66` mounted at `/var/lib/postgresql/data` |
| PostgreSQL data directory | `/var/lib/postgresql/data/pgdata` |
| Image | `ghcr.io/railwayapp-templates/postgres-ssl:18` |
| Deployed image digest | `sha256:469c779c7c57ec6bad4670a0a3cb5a830aa6e0ce4f3707137608de5223a5041c` |
| Successful deployment | `e911278a-551c-4134-92ab-3278eff26e12`, created `2026-09-12T19:42:21.767Z` |

The service was created before its volume was attached. Its private configuration was then installed, the approved image was assigned, and the service was deployed. The owner password was generated in memory and sent only through Railway's variable mutation. It was not written to this document, command output, Git, or the private proof state.

Post-deployment verification used Railway SSH inside the running database service. PostgreSQL reported database `accounts_production`, owner role `postgres`, TLS 1.3, and zero tables in the current `public` schema. Railway inventory reported zero TCP proxies, zero generated service domains, and zero custom domains. The deployment reports the persistent mount at `/var/lib/postgresql/data` and status `SUCCESS`.

The ignored initial operator state is stored at `.auth-proof/accounts-production-postgres.json` with mode `0600`. It contains resource identifiers and verification results only.

## Subsequent schema and client preparation

The initial empty state above was superseded later on September 12. Migration
deployment `35635ee9-619b-4fd7-846c-8973f75ea362` installed schema version 1 and
credential-guard revision 2, and created restricted role
`aegyo_accounts_production_app`. Client preparation deployment
`70143407-c290-4fff-84f8-ba17ef07ce54`, from `e31ee3c`, registered the three
production clients without persisting a bootstrap user.

Independent verification used Railway SSH with a repeatable-read, read-only
transaction and `SET ROLE aegyo_accounts_production_app`:

| Check | Result |
| --- | --- |
| Database and role | Exact dedicated production names matched |
| Schema / guard revision | 1 / 2 |
| Enabled credential triggers | 2 |
| Superuser / role creation / RLS bypass | False |
| Schema creation / protected-column updates / operator revocation | False |
| Users / accounts / sessions | 0 / 0 / 0 |
| Access / refresh tokens | 0 / 0 |
| OAuth clients | 3 |

The one-shot operator's final stdout was unavailable; the table reports observed
database results rather than inferred console output. Its service credentials
were cleared and its deployment stopped. Only the restricted connection is saved
on the dormant Accounts application; it still initializes no database pool while
traffic is disabled. No identity import or public authentication activation took
place. Evidence: `.auth-proof/accounts-production-preparation-verified.json` and
`.auth-proof/accounts-production-schema-preparation.json`, both ignored/private.
