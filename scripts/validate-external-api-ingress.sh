#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 https://api.example.test [alternate-host]" >&2
  echo "Set EXTERNAL_API_KEY or enter it at the hidden prompt." >&2
  exit 2
fi

base_url="${1%/}"
alternate_host="${2:-}"
api_key="${EXTERNAL_API_KEY:-}"
if [[ -z "$api_key" ]]; then
  read -r -s -p "External API key: " api_key
  printf '\n'
fi
if [[ -z "$api_key" ]]; then
  echo "An external API key is required." >&2
  exit 2
fi
if [[ ! "$api_key" =~ ^[[:xdigit:]]{64}$ ]]; then
  echo "The external API key must be the 64-character value issued by Youtarr." >&2
  exit 2
fi
if [[ -n "${EXTERNAL_API_KEY_2:-}" &&
      ! "${EXTERNAL_API_KEY_2}" =~ ^[[:xdigit:]]{64}$ ]]; then
  echo "EXTERNAL_API_KEY_2 must be a 64-character Youtarr key." >&2
  exit 2
fi
failures=0
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

chmod 700 "$tmp_dir"
curl_config="$tmp_dir/curl.conf"
response_headers="$tmp_dir/headers"
response_body="$tmp_dir/body"
request_key_config="$tmp_dir/request-key.conf"

cat >"$curl_config" <<EOF
silent
show-error
connect-timeout = 10
max-time = 30
max-redirs = 0
header = "Accept: application/json"
EOF
chmod 600 "$curl_config"
touch "$request_key_config"
chmod 600 "$request_key_config"

request_as() {
  local key="$1"
  local method="$2"
  local url="$3"
  shift 3
  : >"$response_headers"
  : >"$response_body"
  printf 'header = "x-api-key: %s"\n' "$key" >"$request_key_config"
  curl --config "$curl_config" --config "$request_key_config" --request "$method" \
    --dump-header "$response_headers" --output "$response_body" \
    --write-out '%{http_code}' "$@" "$url"
}

request() {
  local method="$1"
  local url="$2"
  shift 2
  request_as "$api_key" "$method" "$url" "$@"
}

pass() {
  printf 'PASS  %s\n' "$1"
}

fail() {
  printf 'FAIL  %s\n' "$1" >&2
  failures=$((failures + 1))
}

expect_status() {
  local label="$1"
  local method="$2"
  local path="$3"
  local expected="$4"
  local status
  status="$(request "$method" "${base_url}${path}")"
  if [[ "$status" == "$expected" ]]; then
    pass "$label ($status)"
  else
    fail "$label: expected $expected, received $status"
  fi
}

expect_denied() {
  local label="$1"
  local method="$2"
  local path="$3"
  local status
  status="$(request "$method" "${base_url}${path}")"
  if [[ "$status" =~ ^(400|403|404|405)$ ]]; then
    pass "$label ($status)"
  else
    fail "$label: expected 400/403/404/405, received $status"
  fi
}

expect_status "v1 capabilities reachable" GET "/external-api/v1/capabilities" 200

if grep -Eiq '^cache-control:[[:space:]]*.*no-store' "$response_headers" &&
   grep -Eiq '^pragma:[[:space:]]*no-cache' "$response_headers" &&
   grep -Eiq '^vary:[[:space:]]*.*x-api-key' "$response_headers"; then
  pass "external responses are private and key-varying"
else
  fail "external response lacks Cache-Control no-store, Pragma no-cache, or Vary x-api-key"
fi

invalid_status="$(request_as 'invalid-ingress-validation-key' GET \
  "${base_url}/external-api/v1/capabilities")"
valid_status_after_invalid="$(request GET "${base_url}/external-api/v1/capabilities")"
if [[ "$invalid_status" == "401" && "$valid_status_after_invalid" == "200" ]]; then
  pass "authentication responses are not replayed across keys"
else
  fail "cross-key cache probe expected invalid=401 and valid=200; received ${invalid_status}/${valid_status_after_invalid}"
fi

if [[ -n "${EXTERNAL_API_KEY_2:-}" ]]; then
  second_status="$(request_as "$EXTERNAL_API_KEY_2" GET \
    "${base_url}/external-api/v1/capabilities")"
  if [[ "$second_status" == "200" ]] &&
     grep -Eiq '^cache-control:[[:space:]]*.*no-store' "$response_headers" &&
     grep -Eiq '^vary:[[:space:]]*.*x-api-key' "$response_headers"; then
    pass "second key receives an independently authenticated no-store response"
  else
    fail "second-key cache isolation probe failed ($second_status)"
  fi
else
  printf 'SKIP  second valid key (set EXTERNAL_API_KEY_2 for two-key probe)\n'
fi

denied_paths=(
  "/"
  "/api"
  "/api/health"
  "/auth"
  "/auth/login"
  "/setup"
  "/swagger"
  "/socket.io"
  "/images"
  "/api/videos/download"
  "/external-api"
  "/external-api/v2"
  "/external-api/v1%2f..%2f..%2fapi"
  "/external-api%2fv1%2fcapabilities"
  "/%2e%2e/external-api/v1/capabilities"
)

for path in "${denied_paths[@]}"; do
  expect_denied "deny ${path}" GET "$path"
done

for method in PUT PATCH DELETE OPTIONS TRACE CONNECT; do
  expect_denied "deny ${method}" "$method" "/external-api/v1/capabilities"
done

upgrade_status="$(request GET "${base_url}/external-api/v1/capabilities" \
  --header 'Connection: Upgrade' --header 'Upgrade: websocket')"
if [[ "$upgrade_status" != "101" ]] &&
   ! grep -Eiq '^upgrade:[[:space:]]*websocket' "$response_headers"; then
  pass "WebSocket protocol upgrade denied ($upgrade_status)"
else
  fail "WebSocket protocol upgrade was accepted ($upgrade_status)"
fi

oversized_body="$tmp_dir/oversized.json"
printf '{"padding":"' >"$oversized_body"
head -c 17000 /dev/zero | tr '\0' x >>"$oversized_body"
printf '"}' >>"$oversized_body"
oversized_status="$(request POST "${base_url}/external-api/v1/requests/videos" \
  --header 'Content-Type: application/json' --data-binary "@${oversized_body}")"
if [[ "$oversized_status" == "413" ]]; then
  pass "oversized request denied (413)"
else
  fail "oversized request expected 413, received $oversized_status"
fi

if [[ -n "$alternate_host" ]]; then
  alternate_status="$(request GET "${base_url}/external-api/v1/capabilities" \
    --header "Host: ${alternate_host}")"
  if [[ "$alternate_status" =~ ^(400|403|404|421)$ ]]; then
    pass "alternate hostname denied ($alternate_status)"
  else
    fail "alternate hostname was not denied ($alternate_status)"
  fi
else
  printf 'SKIP  alternate hostname (provide second argument to test)\n'
fi

if (( failures > 0 )); then
  printf '\nIngress validation failed: %d check(s)\n' "$failures" >&2
  exit 1
fi

printf '\nIngress validation passed. Record the proxy version and configuration checksum.\n'
