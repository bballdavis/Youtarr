# PRD: External Request API and Approval Workflow

## Document Status

- Status: Draft
- Target project: Youtarr
- Date: 2026-04-17
- Primary use case: Allow external clients such as Plinx (iOS) to safely browse approved Youtarr content and submit download/channel requests through a constrained API.

## Background

Youtarr already supports:

- session-authenticated web UI access
- API key creation in the **API Keys & External Access** settings section
- a REST API with Swagger/OpenAPI docs
- a limited API-key workflow for `POST /api/videos/download`

Today, API keys are intentionally restricted to a single endpoint that queues individual video downloads. That is a good security baseline, but it is too narrow for player-style clients such as Plinx that need to:

- show available channels
- show videos within those channels, including thumbnails and download state
- request videos to be downloaded
- optionally request new channels
- operate without exposing the full Youtarr web UI

This PRD defines a safety-first expansion of Youtarr so it can act as a clearing house for external player/request clients while keeping the main app protected behind separate middleware if desired.

## Problem Statement

Parents or administrators want to expose a limited, API-key-protected surface of Youtarr to external apps without exposing the full admin UI. External clients need read access to approved content and limited request access, while instance owners need:

- strict API-key enforcement
- simple reverse-proxy isolation
- approval controls for risky actions
- auditing and revocation
- predictable paging and filtering for very large channels

## Goals

1. Add a dedicated external API namespace that can be exposed separately from the main app.
2. Require API-key authentication for every external API request.
3. Support read access to channels and channel videos for external clients.
4. Support request-based workflows for downloading videos and optionally adding channels.
5. Add role/scoped API keys with approval-related behavior.
6. Add an in-app request queue for approving or rejecting outstanding requests.
7. Document safe reverse-proxy deployment patterns clearly.
8. Break implementation into manageable PR-sized phases.

## Non-Goals

- Replacing session auth for the main Youtarr web UI in phase 1
- Building multi-user household accounts
- Exposing every existing Youtarr endpoint to API keys
- Full external CRUD over all settings and channel management in phase 1
- Solving public-internet hardening beyond Youtarr's documented safe deployment patterns

## Users and Personas

### Instance Admin

The Youtarr owner who manages channels, downloads, settings, and approvals.

### External Viewer

A client/device allowed to browse approved channels and videos only.

### External Requester

A client/device allowed to browse approved content and submit requests for download or new channels/videos, subject to auto-approval or admin review.

### External Admin

A future phase role that can use a constrained web UI backed by API keys instead of session auth.

## Product Principles

### Safety First

External access must default to least privilege. The new API should be easy to place behind a separate reverse-proxy path rule such as `/external-api/*`, while the rest of Youtarr remains behind stronger middleware or private-only access.

### Explicit Separation

External API routes should live under their own prefix instead of reusing the mixed existing route shape. This simplifies:

- reverse-proxy rules
- auth policy
- logging
- documentation
- future rate-limiting and abuse controls

### Requests, Not Direct Power

Risky actions should be modeled as requests first unless a key's policy explicitly allows auto-approval.

## Proposed Solution Overview

Add a new external API namespace:

- Proposed prefix: `/external-api/v1`

All routes under this prefix:

- require `x-api-key`
- reject session-token-only access
- are governed by API key scopes/role policies
- are documented separately in Swagger/OpenAPI

Core phase 1 capabilities:

1. Read channel list
2. Read channel video lists with paging and filters
3. Submit video download requests
4. Submit new channel requests
5. Review and process pending requests in a new Requests section in the main web UI

## Authentication and Authorization

### External API Authentication

- All `/external-api/v1/*` endpoints require `x-api-key`.
- Requests without a valid API key return `401`.
- Session tokens (`x-access-token`) do not grant access to this namespace.
- No external endpoint is anonymous.

### API Key Model

Expand the existing API key model to support role/scope metadata.

#### Access levels

- `view`: read-only access to allowed external browse endpoints
- `request`: includes `view` plus ability to create requests
- `delete`: includes `request` plus delete requests where allowed by policy
- `admin`: full external API access; phase 1 should still keep sensitive config actions out of scope unless explicitly needed

#### Key policy flags

- `autoApproveVideoRequests`
- `autoApproveDeleteRequests`
- `autoApproveChannelRequests`

These flags should only be available where they make sense for the selected access level.

#### Notes

- Existing keys should migrate safely with a legacy-compatible default, likely equivalent to a narrowly scoped request key for the current single-video endpoint.
- Keys remain hashed at rest.
- Keys remain one-time-view on creation.
- Keys should display metadata such as scope, last used, usage count, and created date.

## External API Surface

The exact path names can change during tech design, but the namespace and capabilities should remain stable.

### 1. Channels List

Purpose: allow external clients to display approved channels.

Example:

- `GET /external-api/v1/channels`

Suggested query support:

- `page`
- `pageSize`
- `search`
- `subfolder`
- `sortBy`
- `sortOrder`

Suggested response fields:

- `id`
- `channelId`
- `title`
- `thumbnailUrl`
- `description` or truncated summary
- `subfolder`
- `videoCount`
- `downloadedCount`
- `lastFetchedAt`

Notes:

- Reuse existing internal channel pagination semantics where possible.
- Return enough metadata for a client like Plinx to render a browsable channel list without needing extra follow-up calls for basic display.

### 2. Channel Videos

Purpose: allow external clients to browse a channel's videos, thumbnails, metadata, and download state.

Example:

- `GET /external-api/v1/channels/:channelId/videos`

Suggested query support:

- `page`
- `pageSize`
- `offset`
- `limit`
- `status=all|downloaded|not_downloaded|requested|pending`
- `search`
- `sortBy`
- `sortOrder`
- `tabType=videos|shorts|streams`
- `dateFrom`
- `dateTo`
- `minDuration`
- `maxDuration`
- `maxRating`

Suggested response fields:

- `youtubeId`
- `title`
- `thumbnailUrl`
- `publishedAt`
- `duration`
- `description`
- `isDownloaded`
- `isRequested`
- `requestStatus`
- `rating`
- `channelId`
- `channelTitle`

#### Paging requirements

This area is critical because some channels have thousands of videos.

Requirements:

- Support deterministic paging over stable, explicit sort orders.
- Prefer `page + pageSize` as the public contract for consistency with current Youtarr behavior.
- Also consider `offset + limit` support if that improves client UX for "videos 30-40" style access.
- Response must include paging metadata:
- `page`
- `pageSize`
- `total`
- `totalPages`
- optionally `offset` and `limit` if supported

#### Data sourcing behavior

The implementation should not require a full fresh YouTube fetch for every external browse request.

Expected behavior:

- External browse endpoints primarily serve from Youtarr's cached/database-backed channel video records.
- Existing channel refresh behavior remains separate from external browsing.
- If the channel has not yet been fully indexed, the API should return a truthful partial-state indicator rather than blocking for a long-running scrape.

Potential response metadata:

- `dataSource=cache|partial_cache`
- `isFullyIndexed`
- `lastIndexedAt`
- `indexingHint`

This keeps response latency predictable and avoids coupling player UX to yt-dlp fetch timing.

### 3. Video Download Request

Purpose: allow external clients to request a video download.

Example:

- `POST /external-api/v1/requests/videos`

Request body:

- `youtubeId` or canonical YouTube URL
- optional `channelId`
- optional client metadata

Behavior:

- If the key policy allows auto-approval, create and execute the download immediately.
- Otherwise, create a pending request record for approval.
- Duplicate requests should be idempotent or return a clear "already requested/downloaded" response.

Response should indicate:

- `status=approved|pending|duplicate|already_downloaded|rejected`
- `requestId`
- `message`

### 4. Channel Request

Purpose: allow external clients to request that a new channel be added.

Example:

- `POST /external-api/v1/requests/channels`

Request body:

- channel URL

Behavior:

- validate URL
- resolve channel metadata when practical
- create pending or auto-approved request based on key policy

This supports the future simplified requester UI and direct client integrations.

### 5. Request Status

Purpose: allow external clients to check the status of their requests.

Examples:

- `GET /external-api/v1/requests`
- `GET /external-api/v1/requests/:requestId`

Suggested filters:

- `status=pending|approved|rejected|completed`
- `type=video|channel|delete`

This is especially useful for mobile apps that need to reflect whether a request is still waiting on admin approval.

## Request Approval Workflow

Add a new Requests area to the main Youtarr web UI for session-authenticated admins.

### UI requirements

- show pending requests
- show approved/rejected/completed history as useful follow-up scope
- filter by request type and status
- display requester key name/prefix for auditing
- approve or reject individual requests
- bulk approve/reject may be added later, but not required for initial delivery

### Request types in phase 1

- video download request
- channel add request

### Potential future request types

- delete downloaded video
- delete channel
- refresh channel

## Configuration UX Changes

Extend the existing **API Keys & External Access** section instead of creating a parallel configuration area.

### Additions

- access level selector: `view`, `request`, `delete`, `admin`
- auto-approve toggles appropriate to the role
- clearer description of what each access level can do
- visibility into rate limits, last used, and request policy
- migration/labeling for legacy keys

### Recommended UX constraints

- `view` cannot create requests
- `request` can create requests but cannot directly delete content
- `delete` only enables delete request flows, not unrestricted deletion
- `admin` should be clearly labeled as high-risk

## Security Requirements

### Namespace Separation

The external API must have its own top-level prefix, recommended as `/external-api/v1`, to enable safe reverse-proxy handling.

### Mandatory API-Key Protection

- Every endpoint under the external prefix requires a valid API key.
- No endpoint under the external prefix is accessible with no auth.
- No fallback to session auth on the external prefix.

### Reverse Proxy Guidance

Documentation must include safe examples for:

- Traefik
- Caddy
- Nginx

Recommended pattern:

- protect the main Youtarr UI with stronger middleware, private network access, or SSO
- optionally expose only `/external-api/*`
- keep Swagger/docs for the external API behind admin access unless intentionally exposed

### Logging and Auditing

Log for each external request:

- API key id/prefix/name
- path
- method
- result
- request id where applicable

### Rate Limiting

Phase 1 should keep per-key rate limiting and extend it to the new external namespace.

Consider:

- different limits for browse vs write endpoints
- lower limits for request-creation endpoints

### Error Handling

Use clear API responses for:

- invalid key
- insufficient scope
- duplicate request
- already downloaded
- resource not found
- approval required
- rate limited

## Phase 2: API-Key-Backed Simplified Web UI

This is intentionally a later phase and should not block phase 1.

Goal: allow API keys to authenticate into a simplified Youtarr web experience.

### Role-based UI behavior

- `view`: videos-only UI, browse existing videos and metadata
- `request`: channel list + channel detail pages + ability to request videos and request new channels
- `admin`: near-full UI access

### Restrictions

- request users should not gain access to settings
- request users should not gain ignore/delete/admin controls unless explicitly authorized
- UI should be capability-driven from server-provided key scope, not hardcoded only in the client

This phase should be treated as a separate PRD or tech design unless phase 1 implementation naturally reveals a simple path.

## Functional Requirements Summary

1. Youtarr must expose a dedicated external API prefix.
2. All external API endpoints must require API keys.
3. The API key model must support access levels and approval-related policy flags.
4. External clients must be able to list channels.
5. External clients must be able to list channel videos with paging, filters, and download-state metadata.
6. External clients must be able to create video download requests.
7. External clients must be able to create channel-add requests.
8. Admins must be able to approve or reject pending requests in the web UI.
9. Documentation must explain safe reverse-proxy deployment.
10. Existing API key behavior must remain backward compatible during migration.

## Success Metrics

- Admin can safely expose only the external API via reverse proxy.
- External client can render channels and videos without session auth.
- External requester can submit a video request that appears in the approval queue.
- Admin can approve the request and the download proceeds normally.
- No external endpoint is accessible without an API key.
- Existing bookmarklet/single-video flows continue to work.

## Proposed Delivery Plan

This should be split into small PRs rather than one large branch.

### PR 1: Foundation and Auth Model

- add external API namespace scaffolding
- extend API key schema/model with access level and policy metadata
- add middleware for API-key-only external routes
- preserve legacy `/api/videos/download` behavior

### PR 2: External Read APIs

- external channels list endpoint
- external channel videos endpoint
- paging/filter contract
- Swagger/OpenAPI docs for external read endpoints

### PR 3: Request Persistence and Workflow

- request table/model
- create video request endpoint
- create channel request endpoint
- duplicate handling and status model

### PR 4: Requests UI

- new Requests section/page in Youtarr
- pending request review
- approve/reject actions
- audit display of requesting key

### PR 5: Documentation and Deployment Guidance

- user docs for API keys and request flows
- reverse-proxy safe setup examples for Traefik, Caddy, and Nginx
- updated authentication docs

### PR 6: Optional Compatibility Cleanup

- decide whether current `/api/videos/download` should remain as-is, proxy to the new request flow, or be documented as legacy
- finalize migration messaging

## Open Questions

1. Should the public external browse contract use `page/pageSize` only, or support both `page/pageSize` and `offset/limit`?
2. Should a `request` key be able to auto-approve downloads only for videos belonging to already-subscribed channels?
3. Should channel requests always require approval even when video requests can auto-approve?
4. Should delete be modeled as direct delete or delete-request-only in phase 1? This PRD recommends delete-request-only.
5. Should external clients be allowed to browse only certain subfolders/libraries per key in a later phase?
6. Should Swagger expose external endpoints publicly, or only when the main admin UI is accessible?

## Recommendations

- Use `/external-api/v1` as the dedicated prefix.
- Keep phase 1 focused on browse plus request workflows only.
- Treat destructive operations as approval-backed requests, not direct actions.
- Reuse existing channel/video pagination and filtering logic where possible, but define a cleaner external contract.
- Make documentation part of the feature, not follow-up work.

## References

- Existing Youtarr API key docs currently describe API keys as limited to single-video downloads.
- Existing Youtarr channel/video routes already support paging and filters for session-authenticated use.
- Existing **API Keys & External Access** settings UX is the right place to extend key capabilities.
