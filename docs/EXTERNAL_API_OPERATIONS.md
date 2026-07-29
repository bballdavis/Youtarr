# External API operations

This runbook defines the supported deployment model for `/external-api/v1`.
Youtarr keeps its existing listener, application authentication, feature flag,
and route mounting. The operator chooses and manages the public TLS proxy.

## Responsibility boundary

Youtarr authenticates every external request with `x-api-key` and enforces the
key's role, permissions, channel grants, content policy, quotas, and request
limits. External-key authentication remains active when `AUTH_ENABLED=false`;
browser sessions, legacy download keys, `Authorization`, and `x-access-token`
do not authenticate this namespace.

The operator owns:

- TLS and the public hostname;
- firewalling the Youtarr origin so its port is private;
- publishing only `/external-api/v1` and `/external-api/v1/...`;
- denying every other path, version, hostname, method, and WebSocket upgrade;
- proxy request-size, header, connection, rate, and timeout limits;
- setting `TRUST_PROXY` to the exact trusted proxy hop or subnet.

Publishing the complete Youtarr port is unsupported for endpoint-only
exposure. It also publishes the SPA, health and setup routes, Swagger, images,
WebSocket, session-management, and legacy APIs. `AUTH_ENABLED=false` does not
disable external API-key authentication, but it can change protection on those
other routes if the operator accidentally exposes them.

## Safe rollout

1. Back up the database and configuration.
2. Deploy with `EXTERNAL_API_ENABLED=false` and all auto-approval disabled.
3. Let migrations complete and confirm the normal private application works.
4. Configure the proxy and run `scripts/validate-external-api-ingress.sh`.
5. Create a view-only external key with the lowest policy and minimum grants.
6. Enable the feature, validate read-only access through the public proxy, and
   revoke the test key to prove immediate shutdown.
7. Add one least-privileged canary key. Enable write scopes individually only
   after monitoring the canary.

Run the validator without placing a key on the command line:

```bash
EXTERNAL_API_KEY='first-64-character-key' \
EXTERNAL_API_KEY_2='optional-second-key' \
scripts/validate-external-api-ingress.sh \
  https://youtarr-api.example.test unexpected.example.test
```

If `EXTERNAL_API_KEY` is omitted, the script uses a hidden prompt. The optional
second key adds a two-key cache-isolation probe.

## Common proxy requirements

The examples assume a private origin at `youtarr:3011` and a dedicated public
host `youtarr-api.example.test`. Replace the certificate details and trusted
proxy network for your deployment.

Every proxy must:

- match only `/external-api/v1` and `/external-api/v1/...`;
- permit `GET`, `HEAD`, and `POST`, with POST bodies limited to 16 KiB;
- forward `x-api-key` and `Content-Type`;
- forward `X-Request-ID` only if it is a bounded token (Youtarr still creates
  its own authoritative request ID);
- remove `Cookie`, `Authorization`, and `x-access-token`;
- disable response caching and request buffering to disk;
- reject WebSocket upgrades and unmatched hostnames.

### Nginx

Place the `map` blocks in the `http` context. The empty default drops invalid
client correlation IDs.

```nginx
map $http_x_request_id $bounded_request_id {
    default "";
    "~^[A-Za-z0-9._:-]{1,64}$" $http_x_request_id;
}

map $http_upgrade $external_upgrade_denied {
    default 1;
    ""      0;
}

server {
    listen 443 ssl default_server;
    server_name _;
    return 404;
}

server {
    listen 443 ssl;
    server_name youtarr-api.example.test;

    ssl_certificate     /etc/ssl/youtarr-api/fullchain.pem;
    ssl_certificate_key /etc/ssl/youtarr-api/privkey.pem;

    location = /external-api/v1 {
        limit_except GET HEAD POST { deny all; }
        if ($external_upgrade_denied) { return 400; }

        client_max_body_size 16k;
        client_body_timeout 15s;
        keepalive_timeout 30s;
        send_timeout 30s;
        proxy_connect_timeout 5s;
        proxy_read_timeout 120s;
        proxy_request_buffering on;
        proxy_max_temp_file_size 0;

        proxy_pass http://youtarr:3011;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Request-ID $bounded_request_id;
        proxy_set_header Cookie "";
        proxy_set_header Authorization "";
        proxy_set_header x-access-token "";
        proxy_set_header Upgrade "";
        proxy_hide_header Set-Cookie;
        add_header Cache-Control "private, no-store" always;
        add_header Pragma "no-cache" always;
    }

    location ^~ /external-api/v1/ {
        limit_except GET HEAD POST { deny all; }
        if ($external_upgrade_denied) { return 400; }

        client_max_body_size 16k;
        client_body_timeout 15s;
        proxy_connect_timeout 5s;
        proxy_read_timeout 120s;
        proxy_request_buffering on;
        proxy_max_temp_file_size 0;

        proxy_pass http://youtarr:3011;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Request-ID $bounded_request_id;
        proxy_set_header Cookie "";
        proxy_set_header Authorization "";
        proxy_set_header x-access-token "";
        proxy_set_header Upgrade "";
        proxy_hide_header Set-Cookie;
        add_header Cache-Control "private, no-store" always;
        add_header Pragma "no-cache" always;
    }

    location / { return 404; }
}
```

Add an Nginx `limit_req_zone` and `limit_conn_zone` sized for your deployment;
the application-side IP limiter is a second boundary, not a substitute.

### Caddy

```caddyfile
{
    servers {
        trusted_proxies static private_ranges
        client_ip_headers X-Forwarded-For
        max_header_size 16KB
    }
}

youtarr-api.example.test {
    @external {
        path /external-api/v1 /external-api/v1/*
        method GET HEAD POST
        not header Connection *Upgrade*
        not header Upgrade *
    }

    handle @external {
        request_body {
            max_size 16KB
        }
        reverse_proxy youtarr:3011 {
            transport http {
                dial_timeout 5s
                response_header_timeout 120s
            }
            header_up -Cookie
            header_up -Authorization
            header_up -x-access-token
            header_up -X-Request-ID
            header_up -Upgrade
            header_up -Connection
            header_down -Set-Cookie
        }
        header Cache-Control "private, no-store"
        header Pragma "no-cache"
    }

    handle {
        respond "Not found" 404
    }
}
```

Use Caddy's rate-limit module or an upstream firewall/service limit when
available. If accepting a client `X-Request-ID`, validate it to
`[A-Za-z0-9._:-]{1,64}` before forwarding; otherwise remove it with
`header_up -X-Request-ID`.

### Traefik

The path regex is intentionally version-specific. Do not define another router
that matches this dedicated hostname/entrypoint; unmatched requests then
receive Traefik's default denial. Do not publish the Youtarr container port on
the host.

```yaml
services:
  youtarr:
    labels:
      - traefik.enable=true
      - traefik.http.routers.youtarr-external.rule=Host(`youtarr-api.example.test`) && PathRegexp(`^/external-api/v1(/.*)?$`) && Method(`GET`,`HEAD`,`POST`)
      - traefik.http.routers.youtarr-external.entrypoints=websecure
      - traefik.http.routers.youtarr-external.tls=true
      - traefik.http.routers.youtarr-external.middlewares=external-buffer,external-rate,external-headers
      - traefik.http.services.youtarr-external.loadbalancer.server.port=3011
      - traefik.http.middlewares.external-buffer.buffering.maxRequestBodyBytes=16384
      - traefik.http.middlewares.external-buffer.buffering.memRequestBodyBytes=16384
      - traefik.http.middlewares.external-rate.ratelimit.average=5
      - traefik.http.middlewares.external-rate.ratelimit.burst=20
      - traefik.http.middlewares.external-headers.headers.customRequestHeaders.Cookie=
      - traefik.http.middlewares.external-headers.headers.customRequestHeaders.Authorization=
      - traefik.http.middlewares.external-headers.headers.customRequestHeaders.x-access-token=
      - traefik.http.middlewares.external-headers.headers.customRequestHeaders.X-Request-ID=
      - traefik.http.middlewares.external-headers.headers.customRequestHeaders.Upgrade=
      - traefik.http.middlewares.external-headers.headers.customRequestHeaders.Connection=
      - traefik.http.middlewares.external-headers.headers.customResponseHeaders.Cache-Control=private, no-store
      - traefik.http.middlewares.external-headers.headers.customResponseHeaders.Pragma=no-cache
```

Configure the Traefik entrypoint's responding timeout, idle timeout, header
size, trusted forwarded-header IPs, connection ceiling, and default
certificate. Remove `X-Request-ID` unless a plugin or upstream proxy validates
the bounded format.

## `TRUST_PROXY`

Rate limits are only meaningful when Express identifies the real client
without trusting attacker-supplied forwarding headers. Use `TRUST_PROXY=1`
only for exactly one trusted proxy hop. Prefer the proxy's exact IP or subnet
when topology permits. Never use an unrestricted value on an origin reachable
by untrusted clients.

## Quotas and emergency controls

Each external key defaults to at most 5 active jobs, 30 accepted writes per
UTC hour, and 200 per UTC day. Administrators may lower, but not raise, these
limits. A shared application ceiling also bounds download, deletion, and
channel-provisioning execution to three total operations (one downloader plus
two provisioning/deletion slots). `/capabilities` reports effective limits and
remaining allowance.

For one compromised client, revoke its key. For the whole namespace, set
`EXTERNAL_API_ENABLED=false` and restart Youtarr. The UI, session APIs, and
legacy endpoint retain their existing behavior.

## Operator checklist

- [ ] Origin port is private; only the dedicated TLS hostname is public.
- [ ] Exact v1 path, hostname, method, WebSocket, body, header, rate,
      connection, and timeout rules pass the ingress validator.
- [ ] `TRUST_PROXY` names only the trusted hop or subnet.
- [ ] External feature starts off; auto-approval starts off.
- [ ] Keys use minimum scopes, rating/media policy, quotas, and channel grants.
- [ ] Revocation and feature-off emergency shutdown are rehearsed.
- [ ] Database/config backups and restoration are tested.
- [ ] 401, 403, 404, 429, 500, and 503 rates are monitored without logging keys.
- [ ] Log access, retention, rotation, and deletion meet local policy.
- [ ] Proxy, cookie, header, path, and API-key sentinel secrets do not appear in
      captured logs.

Youtarr now sanitizes yt-dlp command logging, including proxy credentials,
cookies, headers, and paths. If older logs may contain raw command arguments,
rotate proxy credentials and other embedded secrets, then securely expire
those logs.

## Release evidence

Before public release, run the automated suites and the ingress validator
against each documented proxy implementation. Record the proxy version and
configuration checksum. A configuration example is not evidence that a live
deployment is isolated.
