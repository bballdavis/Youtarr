# API Integration Guide

This guide covers how to use Youtarr's API for external integrations, including bookmarklets, mobile shortcuts, and automation tools.

## Table of Contents
- [Overview](#overview)
- [Authentication](#authentication)
- [API Endpoints](#api-endpoints)
- [Rate Limiting](#rate-limiting)
- [Bookmarklet Setup](#bookmarklet-setup)
- [Mobile Shortcuts](#mobile-shortcuts)
- [Examples](#examples)
- [Security Considerations](#security-considerations)
- [Troubleshooting](#troubleshooting)

## Overview

Youtarr provides an API endpoint that allows you to add YouTube videos to your download queue from external tools. This enables workflows like:

- **Browser Bookmarklet**: One-click download while browsing YouTube
- **Apple Shortcuts**: Share videos from the YouTube app on iOS
- **Android Tasker/Automate**: Automated download workflows
- **Home Assistant/n8n**: Smart home and automation integrations
- **CLI Scripts**: Download individual videos

> **Legacy endpoint note**: `POST /api/videos/download` supports single videos
> only. The separately enabled `/external-api/v1` uses constrained external
> keys for cached browsing and approval-backed video, channel, and deletion
> requests.

## Authentication

### Versioned External API

The authoritative contract is [External API v1](EXTERNAL_API_V1.md). Deployment,
proxy, migration, rollback, and shutdown guidance is in
[External API operations](EXTERNAL_API_OPERATIONS.md).

Set `EXTERNAL_API_ENABLED=true` to expose the versioned external API.
This prefix always requires an `x-api-key`, including when `AUTH_ENABLED=false`.
Only keys assigned a non-legacy external role (`view`, `request`, `delete`, or
`admin`) can use it; existing keys retain `legacy_download` and continue to
work only with `POST /api/videos/download`. An administrator must also grant
each external key access to specific enabled channel database IDs. No grant
means no catalog visibility. `GET /external-api/v1/capabilities` is the
authoritative source for granted scopes, policy, implemented features, and
effective workload quota/remaining allowance.

The cached read API currently includes:

- `GET /external-api/v1/channels` with bounded paging, search, and sorting.
- `GET /external-api/v1/channels/{databaseId}/videos` with bounded paging,
  status, tab, duration, date, search, and sorting filters.
- `GET /external-api/v1/videos` for a complete cursor-paginated catalog across
  all granted channels. Use `status=requestable` to omit downloaded videos and
  the calling key's active requests.
- `GET /external-api/v1/videos/{youtubeId}` for the full curated metadata used
  by Youtarr's one-video detail modal, bounded by the external-work queue.
- `GET /external-api/v1/assets/channels/{databaseId}/thumbnail` for
  authenticated same-origin channel artwork.
- `GET /external-api/v1/assets/videos/{youtubeId}/thumbnail` for eligible
  video artwork, preferring Youtarr's optimized local JPEG and securely
  proxying the approved upstream thumbnail as a fallback.
- `POST /external-api/v1/requests/videos` to persist a request for an eligible
  cached video.
- `POST /external-api/v1/requests/channels` to request canonical channel
  provisioning.
- `POST /external-api/v1/requests/delete-videos` to request deletion of a
  downloaded video asset without removing its channel subscription.
- `GET /external-api/v1/requests` and
  `GET /external-api/v1/requests/{requestId}` to read the calling key's own
  request history and status.

All catalog responses come from Youtarr's local cache. Rating and media-type
policy is applied on the server before rows and counts are returned. Local
filesystem paths, API-key hashes, and ungranted channel existence are never
included in responses. Video and channel `thumbnailUrl` values always point
back to authenticated Youtarr API asset routes; remote clients never need
direct access to Google/YouTube image hosts. Recommendation scoring and
Plex-derived signals remain outside Youtarr.

For a complete integration, follow `nextCursor` from
`GET /external-api/v1/videos` until it is `null`; do not fetch every channel
individually. Omit `status` (or use `all`) for the whole catalog. Use
`requestable` for immediately actionable rows, `available` for every
not-downloaded row including active requests, `downloaded` for Youtarr's
present-file inventory, and `requested` for the calling key's active requests.
Catalog cursors are bound to their filters, sorting, and page size, so restart
traversal instead of reusing a cursor after any of them changes.

Video requests require the `video:request` scope. Youtarr rechecks the key's
channel grant, the enabled channel, cached video membership, removal/ignore
state, media type, and rating policy at request time. Request bodies cannot
override resolution, folders, ratings, audio format, or file structure.

`POST /external-api/v1/requests/videos` accepts:

```json
{
  "youtubeId": "abcdefghijk",
  "channelId": 8,
  "idempotencyKey": "optional-client-operation-id"
}
```

`channelId` is the numeric database ID returned by the channel catalog. The
optional idempotency key is limited to 200 characters and stored only as a
SHA-256 digest. Responses use an `outcome` of `created`, `duplicate`, or
`already_downloaded`, plus a bounded request DTO when a request record exists.
Pending requests appear in Youtarr's session-authenticated **Requests** area. Keys with
video auto-approval enabled immediately queue the canonical YouTube URL through
Youtarr's normal manual-download machinery and channel-owned settings.

Request status is one of `pending`, `approved`, `processing`, `completed`,
`rejected`, `failed`, or `cancelled`. Processing requests are lazily reconciled
to completed when the downloaded `Videos` record appears. List responses
accept an opaque `cursor` (preferred) or the compatible `page` parameter, plus
`pageSize` (maximum 100), and one exact `status` filter. Reads are always
restricted to records created by the calling API key.

Each external key defaults to at most 5 active jobs, 30 accepted writes per
UTC hour, and 200 per UTC day. Administrators may configure lower limits.
Rate and workload rejection uses the standard external JSON error envelope.
All external responses are private, non-cacheable, and vary on `x-api-key`.

### Administrator request review API

The Youtarr web application uses session-authenticated administrator endpoints
under `/api/external-requests`. These endpoints never accept external API keys
and never return key hashes or secret values:

- `GET /api/external-requests` lists all request types with bounded
  `page`/`pageSize` paging and exact `status`, `requestType`, and `apiKeyId`
  filters.
- `GET /api/external-requests/{requestId}` returns safe requester, target, and
  downloader-job metadata.
- `POST /api/external-requests/{requestId}/approve` revalidates and executes a
  pending video, channel, or downloaded-video deletion request.
- `POST /api/external-requests/{requestId}/reject` accepts
  `{"reason":"1 to 300 characters"}` and terminally rejects a pending request.

Approve and reject actions have a dedicated 30-per-minute session/IP rate
limit. Only `pending -> rejected` and
`pending -> approved -> processing|completed|failed` transitions are allowed.
Before approval, Youtarr re-reads and locks the request and current API-key
policy, then rechecks active/revoked state, role, channel grant, enabled
channel, cached catalog membership, removal/ignore state, media type, rating,
downloaded state, and active duplicates. The request UUID is the stable
downloader job boundary. `processing` and `job_id` are stored only after the
queue accepts the job. Validation and queue failures are terminal and clear
the active dedupe key so the client may submit a later request.

Session-authenticated key-management clients can read or replace the complete
allow-list with `GET` or `PUT /api/keys/{id}/channels`; the PUT body is
`{"channelIds":[1,2]}`. Only active external-role keys and enabled channels
are accepted.

The administrator UI creates a constrained key and its initial channel grants
in one database transaction. It also updates policy and the complete grant set
atomically with `PUT /api/keys/{id}/external-access` using
`{"policy":{...},"channelIds":[1,2]}`. A validation failure rolls back the
entire operation. The raw key is returned only after the creation transaction
commits and is never returned by list or update endpoints.

### API Keys

API keys are the recommended authentication method for external integrations. They provide:

- Persistent access (no expiration)
- Scoped permissions (download endpoint only)
- Easy revocation if compromised
- Rate limiting per key

#### Creating an API Key

1. Navigate to **Configuration** in Youtarr
2. Scroll to **API Keys & External Access**
3. Click **Create Key**
4. Enter a descriptive name (e.g., "iPhone Shortcut", "Bookmarklet")
5. **Important**: Copy and save the key immediately - it will not be shown again!

#### Using API Keys

Include the API key in the `x-api-key` header:

```bash
curl -X POST https://your-youtarr-server.com/api/videos/download \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY_HERE" \
  -d '{"url": "https://www.youtube.com/watch?v=VIDEO_ID"}'
```

### Session Tokens

You can also use session tokens (the same tokens used by the web UI) via the `x-access-token` header. However, these expire after 7 days and are less suitable for automation.

## API Endpoints

### POST /api/videos/download

Add a single YouTube video to the download queue.

> **Scope Limitation**: This endpoint only accepts individual video URLs. Playlist URLs, channel URLs, and batch requests are not supported via API keys. Use the web UI for those operations.

**Headers:**
| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | Yes | Must be `application/json` |
| `x-api-key` | Yes* | Your API key |
| `x-access-token` | Yes* | Session token (alternative to API key) |

*One of `x-api-key` or `x-access-token` is required.

**Request Body:**
```json
{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID",
  "resolution": "1080",
  "subfolder": "Movies",
  "skipVideoFolder": true
}
```

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `url` | Yes | string | YouTube video URL |
| `resolution` | No | string | Override resolution (360, 480, 720, 1080, 1440, 2160) |
| `subfolder` | No | string | Override download subfolder |
| `skipVideoFolder` | No | boolean | When `true`, download files directly into the channel folder without creating a video subfolder |

**Success Response (200):**
```json
{
  "success": true,
  "message": "Video queued for download",
  "video": {
    "title": "Video Title",
    "thumbnail": "https://i.ytimg.com/vi/VIDEO_ID/maxresdefault.jpg",
    "duration": 360
  }
}
```

**Error Responses:**

| Status | Response | Description |
|--------|----------|-------------|
| 400 | `{"success": false, "error": "URL is required"}` | Missing or invalid URL |
| 401 | `{"error": "Invalid API key"}` | Invalid or missing authentication |
| 403 | `{"error": "API keys can only access the download endpoint"}` | API key used on wrong endpoint |
| 429 | `{"success": false, "error": "Rate limit exceeded"}` | Too many requests |

### API Key Management Endpoints

These endpoints are only accessible via session authentication (not API keys).

#### GET /api/keys
List all API keys (keys are not shown, only metadata).

#### POST /api/keys
Create a new API key.

**Request Body:**
```json
{
  "name": "My Integration"
}
```

**Response:**
```json
{
  "success": true,
  "message": "API key created. Save this key - it will not be shown again!",
  "id": 1,
  "name": "My Integration",
  "key": "abc123...",
  "prefix": "abc123"
}
```

#### DELETE /api/keys/:id
Revoke an API key while retaining its metadata for audit visibility.

## Rate Limiting

API keys are rate-limited to prevent abuse. The default limit is **10 requests per minute** per API key.

You can adjust this limit in **Configuration → API Keys & External Access → Rate Limit**.

When rate limited, you'll receive a `429` response with:
```json
{
  "success": false,
  "error": "Rate limit exceeded. Try again later."
}
```

The response includes standard rate limit headers:
- `RateLimit-Limit`: Maximum requests per window
- `RateLimit-Remaining`: Remaining requests in current window
- `RateLimit-Reset`: When the window resets

## Bookmarklet Setup

A bookmarklet is a browser bookmark that runs JavaScript when clicked. Youtarr generates a ready-to-use bookmarklet when you create an API key.

### Installation

1. Create an API key in Youtarr
2. In the success dialog, drag the **"📥 Send to Youtarr"** button to your bookmarks bar
3. Alternatively, copy the bookmarklet code and create a bookmark manually

### Usage

1. Navigate to any YouTube video page
2. Click the bookmarklet in your bookmarks bar
3. An alert will confirm the video was added to Youtarr

### Manual Bookmarklet Code

If you need to create the bookmarklet manually:

```javascript
javascript:(function(){
  var k='YOUR_API_KEY';
  var s='https://your-youtarr-server.com';
  var u=location.href;
  if(!/youtube\.com|youtu\.be/.test(u)){
    alert('Not YouTube');
    return;
  }
  fetch(s+'/api/videos/download',{
    method:'POST',
    headers:{'Content-Type':'application/json','x-api-key':k},
    body:JSON.stringify({url:u})
  })
  .then(function(r){return r.json()})
  .then(function(d){
    alert(d.success?'✓ Added: '+(d.video&&d.video.title?d.video.title:'Queued'):'✗ '+d.error)
  })
  .catch(function(){alert('✗ Connection failed')})
})();
```

Replace `YOUR_API_KEY` and `https://your-youtarr-server.com` with your values.

## Mobile Shortcuts

### Apple Shortcuts (iOS/macOS)

1. Create a new Shortcut
2. Add **"Get URLs from Input"** (for Share Sheet integration)
3. Add **"Get Contents of URL"** with:
   - **URL**: `https://your-youtarr-server.com/api/videos/download`
   - **Method**: POST
   - **Headers**: Add `x-api-key` with your API key
   - **Request Body**: JSON with `{"url": "Shortcut Input"}`
4. Add **"Show Notification"** to confirm success
5. Enable "Show in Share Sheet" and select YouTube

Now you can share videos from the YouTube app directly to Youtarr!

### Android (Tasker/Automate)

Create an HTTP Request action with:
- **Method**: POST
- **URL**: `https://your-youtarr-server.com/api/videos/download`
- **Headers**: `Content-Type: application/json`, `x-api-key: YOUR_KEY`
- **Body**: `{"url": "%clipboard"}`

Trigger it with a widget or when copying YouTube URLs.

## Examples

### cURL

```bash
# Basic download
curl -X POST https://youtarr.example.com/api/videos/download \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'

# With resolution override
curl -X POST https://youtarr.example.com/api/videos/download \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "resolution": "720"}'
```

### Python

```python
import requests

API_KEY = "your_api_key"
SERVER = "https://youtarr.example.com"

def download_video(url, resolution=None):
    payload = {"url": url}
    if resolution:
        payload["resolution"] = resolution
    
    response = requests.post(
        f"{SERVER}/api/videos/download",
        json=payload,
        headers={
            "Content-Type": "application/json",
            "x-api-key": API_KEY
        }
    )
    return response.json()

result = download_video("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
print(result)
```

### JavaScript (Node.js)

```javascript
const fetch = require('node-fetch');

const API_KEY = 'your_api_key';
const SERVER = 'https://youtarr.example.com';

async function downloadVideo(url) {
  const response = await fetch(`${SERVER}/api/videos/download`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY
    },
    body: JSON.stringify({ url })
  });
  return response.json();
}

downloadVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  .then(console.log);
```

### Home Assistant (REST Command)

```yaml
rest_command:
  youtarr_download:
    url: "https://youtarr.example.com/api/videos/download"
    method: POST
    headers:
      Content-Type: application/json
      x-api-key: "YOUR_API_KEY"
    payload: '{"url": "{{ url }}"}'
```

Usage in automation:
```yaml
action:
  - service: rest_command.youtarr_download
    data:
      url: "https://www.youtube.com/watch?v=VIDEO_ID"
```

## Security Considerations

1. **Use HTTPS**: Always use HTTPS in production to protect your API keys in transit
2. **Keep Keys Secret**: Never share your API keys or commit them to public repositories
3. **Rotate Keys**: If a key is compromised, delete it immediately and create a new one
4. **Use Descriptive Names**: Name your keys by purpose (e.g., "iPhone", "Work Laptop") so you can identify and revoke specific keys if needed
5. **Monitor Usage**: Check the "Last Used" column to identify unused or suspicious keys
6. **External Auth Proxies**: If using Cloudflare Zero Trust, Authelia, or similar, you'll need to bypass authentication for `/api/videos/download`. This is safe because Youtarr's API key authentication still protects the endpoint. See [Troubleshooting](#cors-error--blocked-by-external-auth-cloudflare-zero-trust-authelia-etc) for setup instructions.

## Troubleshooting

### "Not YouTube" Alert
The bookmarklet only works on youtube.com or youtu.be pages. Make sure you're on a video page.

### "Connection failed" Alert
- Check your Youtarr server is running and accessible
- Verify the server URL in your bookmarklet is correct
- Check browser console for CORS errors

### 401 Unauthorized
- Verify your API key is correct and active
- Check the key hasn't been deleted

### 429 Rate Limited
- Wait a minute before trying again
- Consider increasing the rate limit in Configuration

### CORS Error / Blocked by External Auth (Cloudflare Zero Trust, Authelia, etc.)

If you're running Youtarr behind an authentication proxy like Cloudflare Zero Trust, Authelia, or similar, bookmarklets and external API calls will fail with CORS errors because:

1. The bookmarklet runs from `youtube.com` (cross-origin)
2. Browser sends a preflight OPTIONS request (no auth headers)
3. Your auth proxy blocks the request before it reaches Youtarr

**Solution for Cloudflare Zero Trust:**

1. Go to **Zero Trust Dashboard → Access → Applications**
2. Create a **new application** for the API endpoint:
   - **Application URL**: `yourdomain.com/api/videos/download`
3. Add a policy with:
   - **Action**: **Bypass** (not "Allow" - Allow still requires authentication)
   - **Selector**: Everyone
4. Save the application

The `/api/videos/download` endpoint is still protected by Youtarr's API key authentication, so this bypass is safe.

**Solution for other auth proxies (Authelia, Authentik, etc.):**

Configure your proxy to skip authentication for the `/api/videos/download` path. The exact configuration varies by proxy - consult your proxy's documentation for path-based bypass rules.
