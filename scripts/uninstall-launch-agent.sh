#!/usr/bin/env bash
set -euo pipefail

LABEL="com.transparker.api"
UID_TARGET="gui/$(id -u)"
SERVICE_TARGET="${UID_TARGET}/${LABEL}"
TARGET_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"

launchctl disable "${SERVICE_TARGET}" 2>/dev/null || true
launchctl bootout "${SERVICE_TARGET}" 2>/dev/null || launchctl bootout "${UID_TARGET}" "${TARGET_PATH}" 2>/dev/null || true

if [[ -f "${TARGET_PATH}" ]]; then
  if command -v trash >/dev/null 2>&1; then
    trash "${TARGET_PATH}"
  else
    mkdir -p "${HOME}/.Trash"
    mv "${TARGET_PATH}" "${HOME}/.Trash/${LABEL}.plist.$(date +%s)"
  fi
fi

echo "Uninstalled ${LABEL}"
