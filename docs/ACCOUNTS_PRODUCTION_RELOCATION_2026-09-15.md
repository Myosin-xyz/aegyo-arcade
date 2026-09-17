# Accounts production relocation — September 15, 2026

The dormant Accounts production stack was relocated into the existing Aegyo Railway project so the later legacy import can use Railway private networking without exposing either production database publicly. The Accounts application and its database remain separate services and no legacy user data was imported during this operation.

## Destination resources

- Railway project: `a719c26e-33b9-4a1c-8759-d5401c1e181a`
- Environment: `27e2f29a-5846-48f8-9727-694a97c36ef6`
- Application service: `4f32c9f4-4ff6-4e81-8bda-f93f71e5011b`
- Database service: `baa2ac26-0ff1-4a0e-86c2-dbf5ef6d20de`
- Database volume: `ba0f1326-3464-4289-898f-3095d0a55efe`
- Application deployment: `10679cb6-9534-4d15-81da-8ed11ab986d3`, `SUCCESS`
- Application image digest: `sha256:324869c98dd05b91be542bebd94896303b0586ec76808df92c9bd1b7294bfc8a`
- Database deployment: `a0a94598-e112-4fc4-aa1f-4c1fb4b66c4b`, `SUCCESS`
- Database image digest: `sha256:3b8bc16ccb823c9a293b09d20d4180049502ee2b243b5989d59e258450044e22`

The application was uploaded from a tracked `services/accounts` source allowlist, so Railway records an image digest rather than a Git commit for this deployment. A read-only container inspection subsequently hashed the package manifests and every loaded runtime source file. All 17 hashes match repository commit `ed4f50419293192e0ce5256c16f0498e96982be8` byte for byte, and the container reports Node `v24.21.0`. The exact reproducibility record is in [the runtime manifest](ACCOUNTS_PRODUCTION_RUNTIME_MANIFEST_2026-09-15.json).

## Acceptance evidence

The dedicated PostgreSQL service has no public TCP proxy. The application reaches it over the project-local private hostname with the server certificate and identity pin configured privately.

The restricted application role was checked from the database itself. It is not a superuser, cannot create in `public`, cannot update protected security or role columns, and cannot execute the owner-only revoke function. Schema marker version 1 and credential-guard revision 2 are present, and both required credential/session triggers are enabled.

The accepted database counts were:

| Relation            | Count |
| ------------------- | ----: |
| `user`              |     0 |
| `account`           |     0 |
| `session`           |     0 |
| `oauthAccessToken`  |     0 |
| `oauthRefreshToken` |     0 |
| `oauthClient`       |     3 |

The three client definitions, provider secret, per-application reader keys, and saved Resend configuration were copied exactly from the previous empty production service without printing or regenerating them. `ACCOUNTS_TRAFFIC_ENABLED=false` and `ACCOUNTS_SIGNUP_ENABLED=false` remain set. The generated Railway domain returned HTTP 200 from `/healthz`; `/readyz` returned HTTP 503 as expected for a dormant, traffic-disabled service.

A post-relocation activation audit found and filled three dormant configuration gaps without deploying or opening traffic: `ACCOUNTS_CLIENT_IP_MODE=railway-x-real-ip`, `ACCOUNTS_RAILWAY_IP_VERIFIED=true`, and the legacy password pepper recovered from the exact deployed Aegyo source fallback. The IP trust setting is supported by the earlier four-case authenticated Railway edge test, which included spoofed forwarding headers; the new hostname uses the same Railway proxy path and DNS-only routing. A local, network-free configuration check then exercised the active production branch with the saved values and confirmed production mode, verified Railway IP handling, pinned TLS options, Resend, three distinct state readers, and signup disabled. An origin-specific observation can still be repeated after DNS and certificate issuance as additional evidence, but it is not required to establish the provider-edge overwrite behavior already tested. Traffic remains explicitly disabled.

## Domain and rollback state

Immediately before reassociation, public DNS for `account.aegyoarena.com` was still absent. The pending custom domain was then moved to the accepted destination application. Railway now requires:

- CNAME name: `account`
- CNAME value: `d5d1smmz.up.railway.app`
- Custom-domain resource: `5c0b7ea4-033e-45c2-94a9-3053c50448bc`

Railway's DNS-status response requested no TXT record. The domain remains `REQUIRES_UPDATE` until the CNAME is published and Railway provisions the certificate.

The previous Accounts application `cda65caf-9a5d-4401-ac18-7d14ff4536ee` and dedicated database `c211f7d5-2fcb-4dc8-8c61-561b9dacd3cd` were checked immediately before shutdown: all five user/account/session/token counts were zero and the client count was three. Their active deployments were removed to stop duplicate compute. The service definitions, variables, and database volume were retained for rollback; nothing was deleted from the old database stack.

The shared one-shot operator was scrubbed after provisioning. No configured database URL, password, secret, certificate or identity pin remained when it was handed to the next isolated rehearsal.

This relocation did not freeze the legacy application, import users, activate Accounts traffic, enable signup, change the legacy production database, or establish linked-record ownership evidence. Those remain separately gated cutover tasks.
