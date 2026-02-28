#!/usr/bin/env bash
set -euo pipefail

UNIT_NAME="transparker.service"

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl is required for Linux service management."
  exit 1
fi

if ! systemctl --user show-environment >/dev/null 2>&1; then
  echo "systemd user manager is unavailable for this session."
  exit 1
fi

systemctl --user restart "${UNIT_NAME}"
systemctl --user status "${UNIT_NAME}" --no-pager | grep -E "Loaded:|Active:|Main PID:" || true
