# Staging competition lifecycle proof

September 15, 2026. This records an isolated synthetic proof in the existing
`accounts-staging` environment. It is not a material contest, prize approval,
production exercise, or real-user award.

## Bound scope

- Railway project: `8229f87c-908d-426d-9562-4b01b0e89a50`
- Environment: `accounts-staging`
  (`279e0a09-8ba3-42dc-8d44-a2598d1f3fe9`)
- Arcade service: `arcade-auth-preview`
  (`01e424b3-6137-4ef6-b8fc-94def7963b48`), deployment
  `82d0253e-42aa-411e-83b8-99b13f2cca16`
- Private database: `arcade_auth_staging` on service
  `950e29c3-1592-4b09-be95-572ce43030c5`
- Completed proof round: `staging-lifecycle-20260915-143100`
  (`075278c0-ac69-41ce-88b0-ce8584a82e47`), mode `synthetic`

The member path used the reserved synthetic `@example.invalid` fixture and real
Accounts staging OIDC. The runner read credentials only from ignored mode-0600
proof files. Operator commands ran inside the Arcade staging container against
the private database, with the dedicated operator URL populated from that
container's database binding and exact database-name confirmation. There was no
public database proxy, email, Privy call, production access, payment, shipment,
or message.

## Result

The HTTP-only member proof issued a Snake attempt and repeated the same issuance
key before use; the retry returned the same attempt. It submitted an identical
trace twice and received the persisted verified result. Two valid attempts
scored 10/100 points and 20/200 points. Public standings showed 200 total and
200 maximum daily points, rather than adding both attempts to 300. The public
Snake high score was 20.

The first development run submitted a valid trace faster than its simulated
duration. The deployed verifier rejected it with `impossible_duration`. The
runner was corrected to wait for the trace duration. That rejected receipt was
retained and resolved; it contributed no points and did not block closure.

After the fixed database cutoff:

- Initial `close` created candidate snapshot
  `25878472-05ae-421b-8614-619d70865b00` with one standing and source digest
  `dee52133e9dd77255e5ffd69f8ec6049777f78aae2c63d891e329c47355dee72`.
  The exact retry returned the same snapshot and digest.
- The private mode-0600 review export contained zero pending attempts, one
  candidate and no exact tie. It was converted inside the staging container to
  one explicitly no-value award, `synthetic-staging-proof-only`.
- `finalize` created final result `ede16adc-f69c-4feb-ab4d-68ee07c2d17c`;
  its exact retry returned that result.
- The authenticated member claimed award
  `86b55084-211f-4367-a81f-e91b551330fa`; the exact claim retry returned
  `claimed` with `repeated: true`.
- The operator recorded `synthetic-no-value-staging-record-v1` fulfillment;
  the exact retry returned `fulfilled` with `repeated: true`. No external value
  or delivery action existed.

The final private database reconciliation found one rejected attempt, two
verified attempts, one daily-best row worth 200, and two immutable ledger rows
whose deltas sum to 200. It found exactly one candidate snapshot, one final
result, and one fulfilled award. The audit table has one durable row for each of
`create-draft`, `open`, `close`, `finalize`, and `fulfill`; exact retries did not
duplicate audit effects.

Private structured evidence is stored at
`.auth-proof/competition-staging-lifecycle-report.json`. It contains synthetic
resource identifiers and scores, not credentials, cookies, traces, email,
provider sessions, or user rows. Temporary definition, CA and review files were
removed from the staging container after reconciliation.

## Runner

The guarded runner is
[`staging-lifecycle-proof.mjs`](../scripts/competition/staging-lifecycle-proof.mjs).
It requires:

```sh
ARCADE_COMPETITION_STAGING_CONFIRM=synthetic-staging-only \
ARCADE_COMPETITION_STAGING_ROUND=EXPLICIT_SYNTHETIC_ROUND_SLUG \
  node --import tsx scripts/competition/staging-lifecycle-proof.mjs play
```

After explicit operator finalization, its `claim` mode reauthenticates the same
fixture, claims its single unclaimed synthetic award, and proves the exact
retry. It is intentionally not a round creator, closer, reviewer, finalizer, or
fulfillment tool; those remain explicit operator commands.

The runner refuses the wrong confirmation phrase, non-staging infrastructure
metadata, a non-synthetic round, an unexpected award count, or a fixture whose
email is outside the reserved invalid domain. Do not point it at a shared proof
round or a material/production environment.

## Limits and cleanup

An earlier draft, `staging-lifecycle-20260915-142936`, missed the future-open
guard by seconds. It remains a draft with no enrollment, attempts, snapshot,
award, or public visibility. It was not edited or opened after that refusal.

This run closes the deployed positive-score, daily-best replacement, public
standing/high-score, finalization, ownership claim and exact-retry fulfillment
gaps for a one-member synthetic round. Staging still has no proof in this run of
an unresolved on-time pending receipt blocking close, an audited pending
rejection, disqualification recomputation, or shared-rank review with multiple
members. Those cases remain covered by disposable PostgreSQL integration tests,
not by this staging evidence.

The proposed 14-day material claim period remains unimplemented. Current code
does not store or enforce a deadline, forfeiture, fallback allocation or appeal
window. Until a reviewed mechanism exists, no operator may automatically void
or reassign an unclaimed award based on that proposal.
