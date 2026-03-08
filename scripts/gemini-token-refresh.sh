#!/usr/bin/env bash
# Automatically refresh the Gemini CLI OAuth access token using the stored refresh token.
# Workaround for OpenClaw issue #7549: refresh token present but never used.
#
# Install as a cron job (every 45 minutes):
#   crontab -e
#   */45 * * * * /home/antoniofortes/Projects/email_master/scripts/gemini-token-refresh.sh >> /tmp/gemini-token-refresh.log 2>&1

set -euo pipefail

CREDS_FILE="${HOME}/.gemini/oauth_creds.json"
CLIENT_ID="${GEMINI_OAUTH_CLIENT_ID:-}"
CLIENT_SECRET="${GEMINI_OAUTH_CLIENT_SECRET:-}"
TOKEN_ENDPOINT="https://oauth2.googleapis.com/token"

if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ]; then
  echo "$(date -Iseconds) ERROR: GEMINI_OAUTH_CLIENT_ID and GEMINI_OAUTH_CLIENT_SECRET must be set."
  exit 1
fi

if [ ! -f "$CREDS_FILE" ]; then
  echo "$(date -Iseconds) ERROR: $CREDS_FILE not found. Run 'gemini' once to authenticate."
  exit 1
fi

REFRESH_TOKEN=$(python3 -c "import json; print(json.load(open('$CREDS_FILE'))['refresh_token'])" 2>/dev/null)
if [ -z "$REFRESH_TOKEN" ]; then
  echo "$(date -Iseconds) ERROR: No refresh_token in $CREDS_FILE"
  exit 1
fi

# Check if token still has >10 minutes of life — skip refresh if so
EXPIRY=$(python3 -c "import json; print(json.load(open('$CREDS_FILE')).get('expiry_date', 0))" 2>/dev/null)
NOW_MS=$(python3 -c "import time; print(int(time.time() * 1000))")
REMAINING_MS=$(( EXPIRY - NOW_MS ))
if [ "$REMAINING_MS" -gt 600000 ]; then
  echo "$(date -Iseconds) OK: Token still valid for $((REMAINING_MS / 60000))m — skipping refresh."
  exit 0
fi

# Refresh the access token
RESPONSE=$(curl -s -X POST "$TOKEN_ENDPOINT" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=${CLIENT_ID}" \
  -d "client_secret=${CLIENT_SECRET}" \
  -d "refresh_token=${REFRESH_TOKEN}" \
  -d "grant_type=refresh_token")

# Check for errors
ERROR=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null)
if [ -n "$ERROR" ]; then
  echo "$(date -Iseconds) ERROR: Token refresh failed: $RESPONSE"
  exit 1
fi

# Merge new tokens into the existing creds file (preserves refresh_token, updates access_token + expiry)
python3 -c "
import json, sys, time

response = json.loads('''$RESPONSE''')
with open('$CREDS_FILE', 'r') as f:
    creds = json.load(f)

creds['access_token'] = response['access_token']
creds['token_type'] = response.get('token_type', creds.get('token_type', 'Bearer'))
if 'id_token' in response:
    creds['id_token'] = response['id_token']
if 'scope' in response:
    creds['scope'] = response['scope']
# Google returns expires_in (seconds); convert to expiry_date (ms since epoch)
creds['expiry_date'] = int(time.time() * 1000) + response.get('expires_in', 3600) * 1000

with open('$CREDS_FILE', 'w') as f:
    json.dump(creds, f, indent=2)
"

NEW_EXPIRY=$(python3 -c "import json; print(json.load(open('$CREDS_FILE'))['expiry_date'])")
REMAINING_MIN=$(python3 -c "import time; print(int(($NEW_EXPIRY/1000 - time.time()) / 60))")
echo "$(date -Iseconds) OK: Token refreshed. Valid for ${REMAINING_MIN}m."
