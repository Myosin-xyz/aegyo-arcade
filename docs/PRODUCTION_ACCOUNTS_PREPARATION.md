# Production Accounts preparation — September 12, 2026

The stable production identity origin is `https://account.aegyoarena.com`.
Infrastructure is in the existing Arcade Railway project and production
environment. No new hosting account or provider subscription was created.

| Resource                   | Verified value                                        |
| -------------------------- | ----------------------------------------------------- |
| Project                    | `8229f87c-908d-426d-9562-4b01b0e89a50`                |
| Production environment     | `106dcc90-e997-4d59-86d3-5ba7e66470cd`                |
| Accounts service           | `cda65caf-9a5d-4401-ac18-7d14ff4536ee`                |
| Successful deployment      | `21550dde-e1bd-4264-bebc-b32cddf4d45c`                |
| Committed source bundle    | `4a09e1557150db81a60eedfbcaf63a26b92243f9`            |
| Railway hostname           | `aegyo-accounts-production-production.up.railway.app` |
| Production CNAME target    | `2tmkqmk3.up.railway.app`                             |
| Dedicated database service | `c211f7d5-2fcb-4dc8-8c61-561b9dacd3cd`                |
| Database                   | `accounts_production`                                 |

## Dormant deployment proof

`ACCOUNTS_TRAFFIC_ENABLED=false`, `ACCOUNTS_SIGNUP_ENABLED=false`,
`ACCOUNTS_MAIL_MODE=disabled`, and `ACCOUNTS_ENVIRONMENT=production` are set.
The source bundle was built from committed, allowlisted service files; it excludes
local environment files, proof credentials and the unrelated dirty progress doc.

The runtime initializes no database pool, identity provider or mail sender in
dormant mode. Through the generated Railway hostname, the parent verified:

- `GET /healthz` → 200, `{ok:true}`.
- `/readyz`, `/sign-in`, `/api/auth/sign-up/email` and OIDC discovery → 503,
  `accounts_not_activated`.

The service has no database URL, application secrets, client registrations or
mail credentials. The [database proof](ACCOUNTS_PRODUCTION_DATABASE_PROOF.md)
records an empty persistent PostgreSQL 18 database with no public TCP proxy or
HTTP domain. It has not received schema, users or synthetic fixtures.

## Activation still requires

1. Simon applies the [exact DNS records](SIMON_DNS_HANDOFF.md), then the Accounts
   hostname and certificate are checked. Mailjet suspension is resolved and
   verification/recovery delivery is proven separately.
2. The [real Aegyo restore](REAL_AEGYO_RESTORE_PROOF.md) has passed; migration
   reconciliation still needs an authorized returning-user password canary. The live credential-writer freeze occurs only
   in the coordinated cutover, not during the backup rehearsal.
3. Production schema, restricted database roles, credentials and three confidential
   OAuth clients are provisioned through a reviewed production procedure. The
   synthetic-only staging seed tool must not be used here.
4. Reviewed adapters, identity mappings, rollback evidence and real Privy ownership
   acceptance are ready before shared authentication is enabled across products.

Switching traffic to `true` is not part of infrastructure provisioning. All three
public products continue using their existing authentication paths at this checkpoint.
