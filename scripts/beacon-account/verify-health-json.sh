#!/usr/bin/env sh
set -eu

directory=${1:?usage: verify-health-json.sh DIRECTORY ISSUER SHA SCHEMA}
issuer=${2:?usage: verify-health-json.sh DIRECTORY ISSUER SHA SCHEMA}
sha=${3:?usage: verify-health-json.sh DIRECTORY ISSUER SHA SCHEMA}
schema=${4:?usage: verify-health-json.sh DIRECTORY ISSUER SHA SCHEMA}

command -v jq >/dev/null 2>&1 || {
  echo 'beacon-account: jq is required for health verification' >&2
  exit 1
}

jq --exit-status --arg sha "$sha" --arg schema "$schema" '
  .status == "ok"
  and .gitSha == $sha
  and .schemaVersion == $schema
  and .checks.database == "ok"
  and .checks.mail == "ok"
  and .checks.issuer == "ok"
  and .checks.jwks == "ok"
  and .checks.clients == "ok"
  and .checks.providers == "ok"
' "$directory/ready.json" >/dev/null

jq --exit-status --arg issuer "$issuer" '
  .issuer == $issuer
  and .jwks_uri == ($issuer + "/.well-known/jwks.json")
  and .authorization_endpoint == ($issuer + "/api/account/auth/oauth2/authorize")
  and .token_endpoint == ($issuer + "/api/account/auth/oauth2/token")
  and .userinfo_endpoint == ($issuer + "/api/account/auth/oauth2/userinfo")
  and .introspection_endpoint == ($issuer + "/api/account/auth/oauth2/introspect")
  and .revocation_endpoint == ($issuer + "/api/account/auth/oauth2/revoke")
  and .end_session_endpoint == ($issuer + "/api/account/auth/oauth2/end-session")
  and .response_types_supported == ["code"]
  and .grant_types_supported == ["authorization_code"]
  and .code_challenge_methods_supported == ["S256"]
  and .token_endpoint_auth_methods_supported == ["client_secret_basic"]
' "$directory/discovery.json" >/dev/null

jq --exit-status '
  .keys as $keys
  | ($keys | type == "array" and length > 0)
  and all($keys[];
    (.kid | type == "string" and length > 0 and length <= 128)
    and .kty == "OKP"
    and .alg == "EdDSA"
    and .crv == "Ed25519"
    and (.x | type == "string" and test("^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$"))
    and (has("d") | not)
    and (if has("use") then .use == "sig" else true end)
    and (if has("key_ops") then .key_ops == ["verify"] else true end)
  )
  and (($keys | map(.kid) | unique | length) == ($keys | length))
' "$directory/jwks.json" >/dev/null
