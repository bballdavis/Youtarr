# External API v1

`/external-api/v1` is Youtarr's constrained integration boundary for clients
such as Plinx. It is disabled by default and never accepts a Youtarr browser
session or a legacy download key.

## Enablement and authentication

Set `EXTERNAL_API_ENABLED=true`, restart Youtarr, and create an external-role
key in **Settings → API Keys → API Keys & External Access**. The key is revealed
once. Send it only in the `x-api-key` header over HTTPS.

Existing keys migrate as `legacy_download`. They continue to work only with
`POST /api/videos/download`. Conversely, external-role keys cannot use that
legacy endpoint, so its direct-download behavior cannot bypass external
policies or approval.

The roles are cumulative:

| Role | Effective scopes |
| --- | --- |
| `view` | `catalog:read`, `requests:read` |
| `request` | view plus `video:request`, `channel:request` |
| `delete` | request plus `video:delete` |
| `admin` | same external scopes as `delete` |

`admin` is a policy superset only. It does not authorize remote approval.
Review always requires a normal Youtarr administrator session.

## Policy and grants

Every external key has:

- a maximum allowed movie/TV rating;
- an allow/disallow decision for unrated or unrecognized ratings;
- allowed media types (`video`, `short`, and/or `livestream`);
- separate auto-approval decisions for video, channel, and deletion requests;
- an explicit set of granted Youtarr channel database IDs.

The HTTP contract retains a compact `maxRatingLevel` value, but the
administrator UI presents the actual rating ceilings:

| Level | Administrator label | Movie ratings | TV ratings |
| --- | --- | --- | --- |
| 1 | General audiences | G | TV-Y, TV-G |
| 2 | Parental guidance | PG | TV-Y7, TV-PG |
| 3 | Teen | PG-13 | TV-14 |
| 4 | Mature | R, NC-17 | TV-MA |

YouTube usually does not supply a useful content rating. Youtarr therefore
uses the video's explicit/manual rating when present, then the channel's
manually assigned default rating. If neither is recognized, the key's
`allowUnrated` decision applies. The same calculation is used for catalog
visibility, counts, assets, candidates, request creation, and approval
revalidation.

Youtarr applies one server-side eligibility decision to lists, counts, direct
IDs, assets, candidate feeds, request creation, and approval revalidation.
Disabled or terminated channels never qualify. A missing grant is treated the
same as a nonexistent target.

## Error contract

All responses under `/external-api/*`, including feature-off and unknown-route
404 responses, use:

```json
{
  "error": {
    "code": "not_found",
    "message": "External API route not found",
    "requestId": "optional-correlation-identifier"
  }
}
```

Clients must treat unknown additive fields and unknown enum values as
forward-compatible. They must not infer target existence from 403/404
differences.

The sanitized cross-client decoding fixture is
`fixtures/external-api-v1/contract.json`; its reviewable checksum is recorded
beside it in `SHA256SUMS`. The fixture contains no credentials, private
deployment address, or Plex-derived data.

## Endpoints

### Capabilities

`GET /external-api/v1/capabilities`

Returns the API/server version, effective role/scopes, policy, and feature
flags. Clients should call this before presenting optional actions.

### Granted catalog

`GET /external-api/v1/channels`

Query parameters:

- `page` (default 1), `pageSize` (1–100);
- `search` (maximum 200 characters);
- `subfolder` (exact match, maximum 255 characters);
- `sortBy`: `title`, `videoCount`, `downloadedCount`, or `id`;
- `sortOrder`: `asc` or `desc`.

`GET /external-api/v1/channels/{channelDatabaseId}/videos`

Query parameters:

- `page`, `pageSize`, and `search`;
- `tabType`: `videos`, `shorts`, or `streams`;
- `status`: `downloaded`, `available`, or `requested`;
- `minDuration`, `maxDuration`, `dateFrom`, and `dateTo`;
- `sortBy`: `date`, `title`, or `duration`;
- `sortOrder`: `asc` or `desc`.

Both endpoints read Youtarr's cache. They do not trigger YouTube network
fetches.

### Recommendation candidates

`GET /external-api/v1/videos`

Returns policy-filtered candidates across all granted channels. `pageSize` is
limited to 100 and `page` is limited to 1–3, bounding one refresh to 300 rows.
It accepts `search`, `tabType`, `status`, `sortBy`, and `sortOrder` with the
same meanings as the channel video catalog.

Youtarr supplies candidates only. Plex history, scoring signals, and ranking
must remain on the client and must never be sent to Youtarr.

### Assets

- `GET /external-api/v1/assets/channels/{channelDatabaseId}/thumbnail`
- `GET /external-api/v1/assets/videos/{youtubeId}/thumbnail`

Local assets require the same key, grant, channel state, rating, and media
policy as their catalog row. Youtarr rejects unsafe identifiers, traversal,
symlinks, and resources outside its image directory. Responses are private and
do not redirect.

Public HTTPS thumbnails are returned only for known YouTube/Google image
hosts. A client must fetch those public URLs without the API key.

### Create requests

Video:

```http
POST /external-api/v1/requests/videos
```

```json
{
  "youtubeId": "abcdefghijk",
  "channelId": 8,
  "idempotencyKey": "optional, 1–200 characters"
}
```

Channel:

```http
POST /external-api/v1/requests/channels
```

```json
{
  "channelUrl": "https://www.youtube.com/@example",
  "idempotencyKey": "optional, 1–200 characters"
}
```

Only canonical YouTube handle, `/channel/`, `/c/`, and `/user/` URLs are
accepted. Approval provisions/enables the channel. By default it also grants
the resulting channel to the requesting key; the administrator may turn that
off during approval. That decision is stored with the request so an
idempotent recovery cannot broaden the grant after interrupted execution.
Uncached channel metadata resolution terminates after two minutes.

Downloaded-video deletion:

```http
POST /external-api/v1/requests/delete-videos
```

```json
{
  "youtubeId": "abcdefghijk",
  "channelId": 8,
  "idempotencyKey": "optional, 1–200 characters"
}
```

Deletion applies only to the downloaded video asset. It never removes or
disables a channel subscription. Missing and already-removed targets complete
idempotently and retain a terminal request record for audit.

Created requests return HTTP 202 and `outcome: "created"`. Duplicates and
already-terminal targets return HTTP 200 with `duplicate`,
`already_downloaded`, or `already_deleted`.

### Owner-scoped request reads

- `GET /external-api/v1/requests`
- `GET /external-api/v1/requests/{requestId}`

Reads expose only records owned by the calling key. List paging is limited to
100 rows and accepts an exact `status` filter.

Statuses are `pending`, `approved`, `processing`, `completed`, `rejected`,
`failed`, or `cancelled`. Youtarr reconciles downloader state before returning
results. A terminal downloader job without a produced video becomes `failed`;
it does not remain stuck in `processing`. Video deletion is reconciled to
completed when the asset is already absent. Interrupted channel/deletion
execution can be reclaimed after a five-minute stale window and rerun through
its idempotent operation.

## Administrator review

The web queue uses session-only endpoints under `/api/external-requests`:

- list with `status`, `requestType`, and `apiKeyId` filters;
- request detail;
- approve;
- reject with a 1–300 character reason.

Approval locks the current request, reloads the current key policy, and
revalidates authorization and target state immediately before execution.
Revocation or a policy/grant change therefore takes effect immediately.

## Rate limits

External reads are limited to 120 requests per minute per key. Request writes
are limited to 10 per minute per key. Review actions have a separate
session-only limit of 30 per minute.
