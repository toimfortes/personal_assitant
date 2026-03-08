#!/bin/sh
# Patch OpenClaw's Gemini CLI provider to use the correct User-Agent header.
# The default "google-cloud-sdk vscode_cloudshelleditor/0.1" triggers aggressive
# rate limiting on the Code Assist API. The Gemini CLI format gets Ultra tier limits.

TARGET=$(find /app/node_modules -path "*/providers/google-gemini-cli.js" -print -quit 2>/dev/null)

if [ -n "$TARGET" ]; then
  if grep -q 'google-cloud-sdk vscode_cloudshelleditor' "$TARGET"; then
    sed -i 's|"User-Agent": "google-cloud-sdk vscode_cloudshelleditor/0.1"|"User-Agent": "GeminiCLI/0.32.1/gemini-3-flash-preview (linux; x64)"|' "$TARGET"
    echo "[gemini-patch] Patched User-Agent in $TARGET"
  else
    echo "[gemini-patch] Already patched or header not found in $TARGET"
  fi
else
  echo "[gemini-patch] google-gemini-cli.js not found, skipping"
fi

# Export Gemini OAuth token as GEMINI_API_KEY for audio/image/video transcription.
# parseGeminiAuth() accepts {"token":"..."} format and uses Bearer auth.
CREDS_FILE="/home/node/.gemini/oauth_creds.json"
if [ -f "$CREDS_FILE" ]; then
  TOKEN=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$CREDS_FILE','utf8')).access_token)}catch{}" 2>/dev/null)
  if [ -n "$TOKEN" ]; then
    export GEMINI_API_KEY="{\"token\":\"$TOKEN\"}"
    echo "[gemini-audio] Exported OAuth token as GEMINI_API_KEY for media transcription"
  fi
fi

exec "$@"
