# External API pre-PR validation

This document is the sanitized evidence record for the Youtarr external API
release candidate. A pull request must not claim this gate is complete while
any required row is pending or failed.

Public exposure remains blocked until the operator-run ingress matrix passes
against the exact production Nginx, Caddy, or Traefik configuration.

## Candidate

- Branch: `external-api-integration`
- External namespace: `/external-api/v1`
- Feature default: disabled
- Secrets, Plex data, private hostnames, and raw private URLs: excluded

## Automated evidence

| Gate | Status | Evidence |
| --- | --- | --- |
| Focused backend contract/migration tests | Passed | Eligibility, catalogs, all request types, recovery, auth, management, assets, fixtures, migrations, and bounded channel resolution |
| Endpoint hardening tests | Passed | Fail-closed policy validation, pre-auth IP limiting, normalized parser/method errors, cache isolation, atomic quotas, side-effect revalidation, command-log sentinels, SSRF/private-address/redirect/image bounds, and argument-array execution |
| Ingress validator | Supplied; live run required | `scripts/validate-external-api-ingress.sh` checks v1 reachability, denied application/version/encoded paths, methods, WebSocket upgrades, alternate hosts, body size, and cache headers |
| Frontend lint | Passed | `npm run lint:frontend` |
| Backend lint | Passed | `npm run lint:backend` |
| TypeScript | Passed | `npm run lint:ts` |
| Focused admin UI tests | Passed | API-key access, request queue, and dialog interaction suites; 49 tests, including multi-page channel-grant and nested-select regression coverage |
| Responsive request-management tests | Passed | Desktop table, mobile request cards, media thumbnails, human-readable ratings, status capitalization, and API-key management shortcut |
| Storybook build | Passed | Requests desktop/mobile/review stories and responsive API-key-card story included in `npm run build-storybook --prefix client` |
| GitHub Actions coverage wiring | Passed | Existing CI runs backend and frontend coverage with 70% line thresholds, uploads LCOV summaries, builds Storybook, and runs the Storybook interaction suite; the new source/tests/stories are included by those existing jobs |
| Full backend suite | Passed | 159 suites, 4,074 tests; serial run completed cleanly |
| Full frontend suite | Passed | 225 suites, 4,324 tests; serial run completed cleanly |
| Focused changed-UI coverage | Passed | 38 tests; 77.68% lines across `RequestsPage`, `ApiKeysSection`, and the external rating policy helper |
| Backend coverage | Passed | 87.64% lines, 87.20% statements, 88.32% functions, and 79.48% branches; all exceed the GitHub Actions 70% line gate |
| Frontend coverage | Passed | 87.05% lines, 85.45% statements, 77.31% functions, and 79.18% branches; all exceed the GitHub Actions 70% line gate |
| Production client build | Passed | `npm run build --prefix client` |
| OpenAPI surface | Passed | All 12 external v1 paths and the `ExternalError` schema are present |
| Sanitized shared fixture | Passed | SHA-256 verified by backend contract test |
| Production dependency audit | Passed | `npm audit --omit=dev` reports zero production vulnerabilities; the Swagger dependency tree is pinned to fixed `brace-expansion` 5.0.8 |

## Full-stack matrix

| Scenario | Status | Sanitized evidence to record |
| --- | --- | --- |
| Fresh isolated MariaDB and Youtarr | Passed | `youtarr-external-api-rc`; both services healthy on isolated volumes |
| External key lifecycle and capabilities | Passed | Missing key rejected; constrained key created/authenticated; capabilities verified; revoked key rejected |
| Upgrade from pre-feature schema | Passed | Reviewed down migrations restored the isolated pre-feature boundary; restart reapplied all six feature migrations and retained the legacy key classification. Granular permission rollback revokes any key whose policy cannot be represented by a cumulative legacy role, preventing privilege expansion. |
| Existing-schema idempotent migration | Passed | Same database volume remained healthy across forced Youtarr recreation |
| Canonical-channel migration and concurrent provisioning | Passed | Isolated MariaDB upgrade applied both hardening migrations, created the unique identity index with no duplicates, and 12 concurrent upserts converged on one row |
| Rollback and re-application | Passed | Request-type migration schema assertions passed in both directions |
| Feature-off complete namespace 404 | Passed | Recreated candidate with `EXTERNAL_API_ENABLED=false`; capabilities returned normalized 404 |
| Key create/policy/grants/revoke UI | Passed | Isolated browser session created constrained keys, persisted a rating-policy edit, persisted one synthetic channel grant, and revoked both keys; one-time values were not retained |
| Video/channel/delete admin review | Passed | Isolated rows for all three request types exercised type filtering, cached target metadata, detail views, required rejection reasons, and `pending -> rejected`; no download or deletion was executed |
| Stub downloader state matrix | Pending Docker gate | Request/job transitions |
| Responsive desktop/mobile browser audit | Passed | At 1,280 px the request table remained within its 1,152 px content region; at 390 px it switched to 308 px-wide cards with no page overflow. API-key policy editing also used the responsive card layout. Evidence is stored under `docs/validation/ui-audit/` |
| Real approved public-video download | Passed | Approved Rick Astley public test video `dQw4w9WgXcQ`; request and job reached `completed`/`Complete`, the 640x360 output existed at 9,179,984 bytes, and the stored `TV-PG` rating reported source `Channel Default` |
| Thousands-of-videos query plan | Passed; cursor recheck required | Previous 5,000-row fixture established indexed grant/channel/video joins and 33–125 ms pages. Re-run the gate by following `nextCursor` through the complete catalog and through `status=requestable`; record total rows, duplicate/missing IDs, per-page timing, query plans, and memory. |
| Intended LAN/dev smoke | Blocked: address/admin access required | Sanitized request transcript |
| Nginx/Caddy/Traefik path isolation | Pending Docker gate | Allowed/denied path matrix |

## Responsive UI evidence

The request queue uses the existing Youtarr semantic theme tokens and components.
Large screens retain a review table; tablet and mobile widths use stacked media
cards with request-type, rating, requester, submitted-time, and status chips.
Video and delete targets render a public YouTube thumbnail without attaching an
API key. Channel requests render the channel identity and handle instead of a raw
URL. The queue header links directly to API-key management.

API-key cards use compact, responsive chip rows without exposing the key
prefix. They show the name, reusable movie/TV rating badges, enabled
video/channel/delete-video request permissions, auto-approval state, usage,
and last-used time. Legacy keys and their legacy rate limit appear in a
separate bottom section.

The editor treats view access as the external-key baseline. Video requests,
channel requests, and downloaded-video deletion requests are independent
switches; each enabled permission reveals its own auto-approve switch, which
defaults off. API-key policy controls present a human-readable four-level
movie/TV scale while retaining the existing numeric wire contract:

| Level | Movie ceiling | TV ceiling |
| --- | --- | --- |
| 1 | G | TV-Y / TV-G |
| 2 | PG | TV-Y7 / TV-PG |
| 3 | PG-13 | TV-14 |
| 4 | R / NC-17 | TV-MA |

When YouTube supplies no per-video rating, the manually assigned channel default
is used by the shared server-side eligibility path. The live download above
verified that fallback by persisting `TV-PG` with source `Channel Default`.

Sanitized screenshots:

- `docs/validation/ui-audit/02-before-mobile-requests.png`
- `docs/validation/ui-audit/03-after-desktop-requests.png`
- `docs/validation/ui-audit/04-after-mobile-requests.png`
- `docs/validation/ui-audit/05-after-mobile-rating-policy.png`
- `docs/validation/ui-audit/06-live-download-completed.png`

## Required final assertions

- No unresolved security or functional defect remains.
- Revoked, legacy, missing, invalid, and session-only credentials fail every
  external route.
- Disabled/terminated/ungranted/ineligible records do not leak through data,
  counts, direct IDs, assets, candidates, or request validation.
- A real downloader job reaches the correct terminal request state.
- Rollback and feature-flag shutdown are proven.
- No evidence artifact contains credentials, Plex history, or raw private
  deployment URLs.
