<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Mobile parity

The Aegyo mobile app (`Myosin-xyz/aegyo-mobile`) embeds `/play/[gameId]`, `/account` and `/championship` in a WebView and calls `/api/session`, `/api/leaderboards/[gameId]`, `/api/competition` and `/api/competition/me` natively. Its game catalog is a static mirror of the registry. The full inventory is `docs/MOBILE_CONTRACT.md`.

Guarded paths: `src/games/registry.ts`, `src/games/*/meta.ts`, `src/shell/host.tsx`, `src/app/play/**`, `src/app/api/{session,leaderboards,competition,accounts}/**`, `src/app/api/_shared/http.ts`, `src/accounts/cookies.ts`, `src/i18n/**`, `src/app/{championship,account}/**`, `public/games/**`.

When a change touches one of them:

- Keep it backward compatible or version it. Never turn the host's `/`, `/championship…` or `/leaderboard/…` anchors into buttons, change those hrefs, or add new host navigation without a mobile plan.
- Update `docs/MOBILE_CONTRACT.md` and `tests/unit/mobile-contract.test.ts` in the same PR.
- Open a `web-parity: <change>` issue in aegyo-mobile and link it in the PR template's Mobile parity section.
- New game: add the mobile catalog entry and both posters to the checklist. New user-facing feature: say ship, skip or follow-up for mobile.
