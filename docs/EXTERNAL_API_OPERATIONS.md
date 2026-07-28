# External API operations

This runbook covers deployment, proxy isolation, migration, rollback, and
emergency shutdown for `/external-api/v1`.

## Safe rollout

1. Back up the database and Youtarr configuration.
2. Deploy the release with `EXTERNAL_API_ENABLED=false`.
3. Let startup migrations complete and confirm normal Youtarr health.
4. Create an external-role key in the web UI, assign its exact policy, and
   grant only intended enabled channels.
5. Set `EXTERNAL_API_ENABLED=true` and restart.
6. Verify capabilities locally, then through the intended proxy/LAN path.
7. Revoke the test key and verify that access fails immediately.

Never expose the full Youtarr port merely to support an external client. Use a
VPN/LAN boundary or publish only `/external-api/*`.

## Reverse proxy isolation

These examples assume Youtarr is reachable internally as `youtarr:3011` and
the external hostname is dedicated to the integration API.

### Nginx

```nginx
server {
    listen 443 ssl;
    server_name youtarr-api.example.test;

    location ^~ /external-api/ {
        proxy_pass http://youtarr:3011;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location / {
        return 404;
    }
}
```

### Caddy

```caddyfile
youtarr-api.example.test {
    handle /external-api/* {
        reverse_proxy youtarr:3011
    }

    handle {
        respond "Not found" 404
    }
}
```

### Traefik

```yaml
services:
  youtarr:
    labels:
      - traefik.enable=true
      - traefik.http.routers.youtarr-external.rule=Host(`youtarr-api.example.test`) && PathPrefix(`/external-api/`)
      - traefik.http.routers.youtarr-external.entrypoints=websecure
      - traefik.http.routers.youtarr-external.tls=true
      - traefik.http.services.youtarr-external.loadbalancer.server.port=3011
```

Do not add routers for `/api`, `/auth`, `/swagger`, `/socket.io`, `/health`,
or the SPA on this hostname. Configure `TRUST_PROXY` to the exact trusted hop
count or subnet; do not broadly trust client-supplied forwarding headers.

## Migration verification

Youtarr runs migrations automatically during startup. The external feature
adds key-policy columns, the channel-grant table, request storage, nullable
targets and persisted grant decisions for channel requests, catalog/query
indexes, and request-management indexes.

For a release candidate, verify all of these paths in an isolated database:

- fresh database to current head;
- database stopped immediately before the external migrations, then upgraded;
- already-current database restarted and migrated idempotently;
- rollback of the external request type expansion;
- re-application after rollback.

Rollback of the key-policy migration disables every non-legacy key before
removing its role. Rollback of the request-type expansion deletes channel and
delete request records before restoring the original non-null video columns.
Treat rollback as a destructive recovery operation and take a backup first.

## Emergency shutdown

Set `EXTERNAL_API_ENABLED=false` and restart Youtarr. The entire
`/external-api/*` namespace then returns the versioned 404 error envelope.
The Youtarr UI, session admin APIs, and legacy endpoint continue according to
their own configuration.

For a single compromised client, revoke its key instead. Revocation is
immediate and retained for audit visibility.

External request approval requires a Youtarr session and is unavailable while
`AUTH_ENABLED=false`; a platform-auth bypass is not treated as a review
session. Key-management routes may still follow the deployment's platform
authentication, but always reject any request carrying `x-api-key`.

## Logs and privacy

Operational logs may contain key database IDs, key display names/prefixes,
request UUIDs, channel database IDs, YouTube IDs, and state transitions. They
must never contain:

- raw API keys or stored key hashes;
- browser session tokens;
- full private deployment URLs;
- Plex watch history or recommendation signals.
