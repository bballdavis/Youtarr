# Youtarr external API PR program

This file defines the review boundaries for the completed local Youtarr
candidate. It does not authorize publishing a branch or opening a pull
request. Every PR remains blocked until
`docs/EXTERNAL_API_VALIDATION.md` records a passing pre-PR gate.

PRs are sequential, not stacked. After each merge, the next validated logical
commit is replayed onto the updated `dev` base and its focused plus regression
checks are rerun.

## Y1 — `codex/external-api-foundation`

Purpose: establish a disabled-by-default, constrained authentication boundary.

Included:

- `EXTERNAL_API_ENABLED` namespace gate;
- legacy versus external key types and cumulative roles;
- strict key-policy validation and rate limits;
- capabilities and normalized error envelope;
- correlation IDs, log redaction, and zero-handle logger/config lifecycle;
- rollback-safe key migration and authentication/operator documentation.

Excluded: catalog data, grants, requests, and client UI.

Evidence: auth/policy migrations, middleware/routes, error-contract tests,
logger tests, lint, and backend open-handle gate.

Rollback: disable the feature first; key-policy rollback disables constrained
keys before removing their distinguishing columns.

## Y2 — `codex/external-catalog-grants`

Purpose: expose only explicitly granted, policy-eligible cached media.

Included:

- channel grant schema and session management APIs;
- enabled/non-terminated channel and video catalogs;
- search, subfolder, status, duration, date, sort, and stable paging filters;
- private channel/video assets with path/symlink containment;
- public thumbnail host allow-list;
- catalog query indexes and contract documentation.

Excluded: request creation and recommendation ranking.

Evidence: grant migration/module tests, catalog SQL/asset tests, index migration
tests, and Docker `EXPLAIN` evidence in the validation report.

Rollback: dropping grants fails closed; catalog indexes are independently
removable.

## Y3 — `codex/external-video-requests`

Purpose: add owner-scoped, idempotent video requests using Youtarr's downloader.

Included:

- request schema and owner reads;
- video validation through shared rating/media eligibility;
- idempotency and concurrent deduplication;
- stable request UUID downloader boundary;
- pending/approval/processing/terminal reconciliation;
- failed terminal job handling, including completed-without-output;
- legacy download regression/deprecation documentation.

Excluded: channel requests, deletion, and generic web review.

Evidence: request service/route/migration tests and deterministic downloader
state tests.

Rollback: request storage can be removed after feature shutdown; legacy
download behavior remains available only to legacy keys.

## Y4 — `codex/external-channel-requests`

Purpose: add bounded approval-backed channel provisioning.

Included:

- canonical handle, `/channel/`, `/c/`, and `/user/` targets;
- two-minute metadata process timeout;
- approval-time key revalidation;
- enable/provision execution and default grant to requester;
- persisted grant decision and stale idempotent recovery.

Excluded: deletion and any remote approval authority.

Evidence: canonicalization, creation race, provisioning, grant, timeout, and
recovery tests.

Rollback: the request-type rollback removes channel request rows before
restoring non-null video target columns; a backup is mandatory.

## Y5 — `codex/external-delete-requests`

Purpose: make downloaded-video deletion parent/client initiated but
administrator approved.

Included:

- `delete` role enforcement;
- approval-time grant/rating/media/downloaded-state revalidation;
- deletion of the downloaded asset only;
- idempotent already-absent completion with an audit record;
- stale execution recovery and state reconciliation.

Excluded: channel subscription removal and direct external deletion.

Evidence: role, absent-target, approval, execution failure, recovery, and
reconciliation tests.

Rollback: the request-type rollback removes deletion request rows; deleted
media itself is not restored by a database rollback.

## Y6 — `codex/external-request-management`

Purpose: provide one session-only queue for all external request types.

Included:

- list/detail APIs with status, type, and requester filters;
- safe requester/target/job metadata;
- approve/reject actions with current-state revalidation;
- channel grant decision control;
- generic web queue and retryable UI states;
- desktop review table plus tablet/mobile media cards using semantic theme
  tokens;
- public video thumbnails, channel identities, human-readable statuses, and a
  direct API-key-management shortcut.

Excluded: review through an external `admin` key.

Evidence: session-only route tests, service transition tests,
`RequestsPage` acceptance tests, responsive Storybook states, and desktop plus
mobile browser captures.

Rollback: disable the external feature and retain request records for audit;
the management UI can be removed without changing request data.

## Y7 — `codex/external-access-settings`

Purpose: let an administrator create and maintain the exact constrained access
policy.

Included:

- role, human-readable movie/TV rating ceiling, unrated, media, and
  auto-approval controls;
- documented manual channel-default rating fallback used by the shared
  server-side eligibility path;
- searchable enabled/non-terminated channel picker;
- transactional creation with initial grants;
- atomic policy-plus-grant replacement;
- confirmation only for privilege increases;
- one-time secret reveal and soft-revocation language;
- unconditional rejection of `x-api-key` on management routes.

Excluded: key recovery, raw-key listing, and legacy/constrained type
conversion.

Evidence: API module/route tests, `ApiKeysSection` acceptance tests, responsive
Storybook states, and the live public-video channel-rating fallback result.

Rollback: revoke affected keys first; transactional validation ensures a
partial policy/grant update cannot commit.

## Y8 — `codex/external-recommendation-feed`

Purpose: provide a bounded private candidate set without receiving Plex data.

Included:

- cross-channel `GET /external-api/v1/videos`;
- maximum three pages and 100 rows per page;
- stable ordering, filters, policy/grant enforcement, and private asset
  fallback;
- active versus terminal request-state semantics;
- candidate query indexes and privacy contract.

Excluded: scoring, ranking, Plex history, and recommendation logs.

Evidence: candidate bound/filter tests plus the Docker thousands-row query
plan and timing record.

Rollback: disable the capabilities flag/route; no recommendation state is
stored in Youtarr.

## Y9 — `codex/external-api-release-hardening`

Purpose: make the combined system deployable, reversible, and independently
verifiable.

Included:

- OpenAPI coverage and authoritative v1 contract;
- Nginx, Caddy, and Traefik isolation examples;
- migration/rollback and emergency-shutdown runbook;
- isolated MariaDB/Youtarr release-candidate compose and smoke script;
- checksum-pinned sanitized cross-client fixture;
- consolidated architecture, privacy, troubleshooting, and validation record.

Excluded: publishing any PR before the full-stack gate passes.

Evidence: all backend/frontend suites, lint, TypeScript, production build,
fresh/upgrade/idempotent/rollback migrations, browser workflows, deterministic
and real downloader cases, query plans, proxy isolation, feature-off proof,
and intended LAN/dev smoke.

Rollback: follow `docs/EXTERNAL_API_OPERATIONS.md`; preserve the sanitized
validation report and never include credentials, private URLs, or Plex
history.
