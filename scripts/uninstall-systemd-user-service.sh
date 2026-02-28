#!/usr/bin/env bash
set -euo pipefail

UNIT_NAME="transparker.service"
TARGET_PATH="${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user/${UNIT_NAME}"

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl is required for Linux service management."
  exit 1
fi

if ! systemctl --user show-environment >/dev/null 2>&1; then
  echo "systemd user manager is unavailable for this session."
  exit 1
fi

systemctl --user disable --now "${UNIT_NAME}" 2>/dev/null || true

if [[ -f "${TARGET_PATH}" ]]; then
  if command -v trash >/dev/null 2>&1; then
    trash "${TARGET_PATH}"
  else
    TRASH_DIR="${XDG_DATA_HOME:-${HOME}/.local/share}/Trash/files"
    mkdir -p "${TRASH_DIR}"
    mv "${TARGET_PATH}" "${TRASH_DIR}/${UNIT_NAME}.$(date +%s)"
  fi
fi

systemctl --user daemon-reload

echo "Uninstalled ${UNIT_NAME}"
