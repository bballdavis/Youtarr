#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.external-api-rc.yml"
PROJECT_NAME="youtarr-external-api-rc"
RC_PORT="${EXTERNAL_API_RC_PORT:-3187}"
BASE_URL="http://127.0.0.1:${RC_PORT}"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/youtarr-external-api-rc.XXXXXX")"

cleanup() {
  find "$TEMP_DIR" -depth -delete 2>/dev/null || true
  if [[ "${KEEP_EXTERNAL_API_RC:-0}" != "1" ]]; then
    docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" down --volumes \
      --remove-orphans >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

json_value() {
  node -e '
    const fs = require("fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const path = process.argv[2].split(".");
    let current = value;
    for (const key of path) current = current?.[key];
    if (current === undefined || current === null) process.exit(2);
    process.stdout.write(String(current));
  ' "$1" "$2"
}

assert_json_value() {
  local file="$1"
  local path="$2"
  local expected="$3"
  local actual
  actual="$(json_value "$file" "$path")" || fail "Missing JSON field $path"
  [[ "$actual" == "$expected" ]] ||
    fail "Expected $path=$expected but received $actual"
}

command -v docker >/dev/null || fail "Docker is not installed"
docker info >/dev/null 2>&1 || fail "Docker Desktop/daemon is not running"
command -v curl >/dev/null || fail "curl is not installed"
command -v node >/dev/null || fail "Node.js is not installed"

cd "$ROOT_DIR"
echo "Building the production client..."
npm run build --prefix client >/dev/null

echo "Starting isolated MariaDB and Youtarr release candidate..."
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" up --build --detach --wait

status="$(curl --silent --output "$TEMP_DIR/missing-key.json" --write-out '%{http_code}' \
  "$BASE_URL/external-api/v1/capabilities")"
[[ "$status" == "401" ]] || fail "Missing-key capabilities returned HTTP $status"
assert_json_value "$TEMP_DIR/missing-key.json" error.code missing_api_key

curl --fail --silent --show-error \
  -H 'Content-Type: application/json' \
  --data '{"username":"external-api-rc-admin","password":"external-api-rc-password"}' \
  "$BASE_URL/auth/login" >"$TEMP_DIR/login.json"
SESSION_TOKEN="$(json_value "$TEMP_DIR/login.json" token)" ||
  fail "Administrator login did not return a token"

curl --fail --silent --show-error \
  -H 'Content-Type: application/json' \
  -H "x-access-token: $SESSION_TOKEN" \
  --data '{"name":"Pre-feature legacy key"}' \
  "$BASE_URL/api/keys" >"$TEMP_DIR/create-legacy-key.json"
LEGACY_KEY="$(json_value "$TEMP_DIR/create-legacy-key.json" key)" ||
  fail "Legacy key creation did not return the one-time key"

echo "Exercising upgrade from the pre-feature schema boundary..."
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" exec -T youtarr node - <<'NODE'
const { sequelize, Sequelize } = require('./server/db');
const migrationNames = [
  '20260726120000-add-external-api-key-policy',
  '20260726130000-create-api-key-channel-grants',
  '20260726140000-create-external-requests',
  '20260726150000-expand-external-request-types',
  '20260726151000-add-external-catalog-indexes',
];
(async () => {
  await sequelize.authenticate();
  const queryInterface = sequelize.getQueryInterface();
  for (const name of [...migrationNames].reverse()) {
    await require(`./migrations/${name}`).down(queryInterface, Sequelize);
  }
  const metadataNames = migrationNames.flatMap((name) => [name, `${name}.js`]);
  await sequelize.query('DELETE FROM SequelizeMeta WHERE name IN (:metadataNames)', {
    replacements: { metadataNames },
  });
  const apiKeys = await queryInterface.describeTable('ApiKeys');
  const tables = (await queryInterface.showAllTables())
    .map((table) => String(table).toLowerCase());
  if (apiKeys.role || tables.includes('external_requests') ||
      tables.includes('api_key_channel_grants')) {
    throw new Error('Pre-feature schema assertion failed');
  }
  await sequelize.close();
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
NODE

EXTERNAL_API_ENABLED=true docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" \
  up --detach --force-recreate --wait youtarr >/dev/null
status="$(curl --silent --output "$TEMP_DIR/legacy-key.json" --write-out '%{http_code}' \
  -H "x-api-key: $LEGACY_KEY" \
  "$BASE_URL/external-api/v1/capabilities")"
[[ "$status" == "401" ]] || fail "Migrated legacy key returned HTTP $status"
assert_json_value "$TEMP_DIR/legacy-key.json" error.code invalid_api_key

curl --fail --silent --show-error \
  -H 'Content-Type: application/json' \
  -H "x-access-token: $SESSION_TOKEN" \
  --data '{
    "name":"External API RC",
    "policy":{
      "role":"delete",
      "autoApproveVideoRequests":false,
      "autoApproveChannelRequests":false,
      "autoApproveDeleteRequests":false,
      "maxRatingLevel":2,
      "allowUnrated":false,
      "allowedMediaTypes":["video"]
    }
  }' \
  "$BASE_URL/api/keys" >"$TEMP_DIR/create-key.json"
EXTERNAL_KEY="$(json_value "$TEMP_DIR/create-key.json" key)" ||
  fail "Key creation did not return the one-time key"
EXTERNAL_KEY_ID="$(json_value "$TEMP_DIR/create-key.json" id)" ||
  fail "Key creation did not return an ID"

curl --fail --silent --show-error \
  -H "x-api-key: $EXTERNAL_KEY" \
  "$BASE_URL/external-api/v1/capabilities" >"$TEMP_DIR/capabilities.json"
assert_json_value "$TEMP_DIR/capabilities.json" apiVersion 1
assert_json_value "$TEMP_DIR/capabilities.json" role delete
assert_json_value "$TEMP_DIR/capabilities.json" features.channelRequests true
assert_json_value "$TEMP_DIR/capabilities.json" features.deleteRequests true
assert_json_value "$TEMP_DIR/capabilities.json" features.recommendations true
assert_json_value "$TEMP_DIR/capabilities.json" features.videoDetails true

echo "Exercising the MariaDB rollback/re-application boundary..."
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" exec -T youtarr node - <<'NODE'
const { sequelize, Sequelize } = require('./server/db');
const migration = require('./migrations/20260726150000-expand-external-request-types');
(async () => {
  await sequelize.authenticate();
  const queryInterface = sequelize.getQueryInterface();
  await migration.down(queryInterface, Sequelize);
  const rolledBack = await queryInterface.describeTable('external_requests');
  if (rolledBack.channel_url || rolledBack.grant_to_requesting_key ||
      rolledBack.channel_id.allowNull || rolledBack.youtube_id.allowNull) {
    throw new Error('Rollback schema assertion failed');
  }
  await migration.up(queryInterface, Sequelize);
  const reapplied = await queryInterface.describeTable('external_requests');
  if (!reapplied.channel_url || !reapplied.grant_to_requesting_key ||
      !reapplied.channel_id.allowNull || !reapplied.youtube_id.allowNull) {
    throw new Error('Re-application schema assertion failed');
  }
  await sequelize.close();
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
NODE

curl --fail --silent --show-error \
  -X DELETE \
  -H "x-access-token: $SESSION_TOKEN" \
  "$BASE_URL/api/keys/$EXTERNAL_KEY_ID" >"$TEMP_DIR/revoke.json"
assert_json_value "$TEMP_DIR/revoke.json" success true

status="$(curl --silent --output "$TEMP_DIR/revoked.json" --write-out '%{http_code}' \
  -H "x-api-key: $EXTERNAL_KEY" \
  "$BASE_URL/external-api/v1/capabilities")"
[[ "$status" == "401" ]] || fail "Revoked key returned HTTP $status"
assert_json_value "$TEMP_DIR/revoked.json" error.code invalid_api_key

echo "Proving feature-flag shutdown..."
EXTERNAL_API_ENABLED=false docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" \
  up --detach --force-recreate --wait youtarr >/dev/null
status="$(curl --silent --output "$TEMP_DIR/disabled.json" --write-out '%{http_code}' \
  "$BASE_URL/external-api/v1/capabilities")"
[[ "$status" == "404" ]] || fail "Disabled external API returned HTTP $status"
assert_json_value "$TEMP_DIR/disabled.json" error.code not_found

echo "PASS: isolated startup, pre-feature upgrade, authentication, capabilities,"
echo "      rollback/re-application, revocation, and feature-flag shutdown"
echo "      completed without printing secrets."
if [[ "${KEEP_EXTERNAL_API_RC:-0}" == "1" ]]; then
  echo "KEEP_EXTERNAL_API_RC=1: isolated containers and volumes were retained."
fi
