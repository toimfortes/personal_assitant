#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

SQUID_CONF_DIR="/etc/squid/conf.d"
SQUID_CONF_FILE="${SQUID_CONF_DIR}/zz-goplaces-egress.conf"
SQUID_MAIN_CONF="/etc/squid/squid.conf"
BACKUP_FILE="/etc/squid/squid.conf.bak.$(date +%Y%m%d%H%M%S)"

mkdir -p "${SQUID_CONF_DIR}"

cat > "${SQUID_CONF_FILE}" <<'EOF'
# Managed by scripts/setup-goplaces-egress-squid.sh
# Hardened proxy profile for goplaces:
# - Allows CONNECT only to Google APIs domains needed for Places/Routes.
# - Denies all other outbound destinations through this proxy.

acl local_clients src 127.0.0.1/32 172.16.0.0/12
acl SSL_ports port 443
acl CONNECT method CONNECT
acl allowed_google dstdomain .googleapis.com

http_access deny !SSL_ports
http_access deny CONNECT !SSL_ports
http_access allow local_clients allowed_google
http_access deny all

via off
forwarded_for delete
request_header_access X-Forwarded-For deny all
request_header_access Via deny all
EOF

echo "Wrote ${SQUID_CONF_FILE}"

if [[ -f "${SQUID_MAIN_CONF}" ]]; then
  cp "${SQUID_MAIN_CONF}" "${BACKUP_FILE}"
  # Disable broad localhost/localnet allows in main config; our allowlist lives in conf.d.
  sed -E -i \
    -e 's|^[[:space:]]*http_access[[:space:]]+allow[[:space:]]+localhost[[:space:]]*$|# hardening disabled: http_access allow localhost|' \
    -e 's|^[[:space:]]*http_access[[:space:]]+allow[[:space:]]+localnet[[:space:]]*$|# hardening disabled: http_access allow localnet|' \
    "${SQUID_MAIN_CONF}"
  echo "Patched ${SQUID_MAIN_CONF} (backup: ${BACKUP_FILE})"
fi

if command -v squid >/dev/null 2>&1; then
  squid -k parse
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl restart squid
  systemctl --no-pager --full status squid | head -n 40
else
  service squid restart
  service squid status || true
fi

if command -v ufw >/dev/null 2>&1; then
  ufw allow proto tcp from 172.16.0.0/12 to any port 3128 comment 'goplaces-squid-proxy-docker' || true
  ufw allow in on docker0 to any port 3128 proto tcp comment 'goplaces-squid-proxy' || true
fi

echo "Squid egress hardening applied."
echo "Next: restart OpenClaw container so goplaces picks GOPLACES_HTTPS_PROXY."
