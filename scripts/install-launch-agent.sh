#!/usr/bin/env bash
set -euo pipefail

LABEL="com.transparker.api"
UID_TARGET="gui/$(id -u)"
SERVICE_TARGET="${UID_TARGET}/${LABEL}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEMPLATE_PATH="${PROJECT_DIR}/launchd/${LABEL}.plist"
TARGET_DIR="${HOME}/Library/LaunchAgents"
TARGET_PATH="${TARGET_DIR}/${LABEL}.plist"
LOG_DIR="${HOME}/Library/Logs/Transparker"
BUN_BIN="$(command -v bun || true)"

if [[ -z "${BUN_BIN}" ]]; then
  echo "bun is not installed or not in PATH."
  exit 1
fi

mkdir -p "${TARGET_DIR}" "${LOG_DIR}"

sed \
  -e "s|__BUN_PATH__|${BUN_BIN}|g" \
  -e "s|__PROJECT_DIR__|${PROJECT_DIR}|g" \
  -e "s|__LOG_DIR__|${LOG_DIR}|g" \
  "${TEMPLATE_PATH}" > "${TARGET_PATH}"

launchctl bootout "${UID_TARGET}" "${TARGET_PATH}" 2>/dev/null || true
launchctl bootstrap "${UID_TARGET}" "${TARGET_PATH}"
launchctl enable "${SERVICE_TARGET}"
launchctl kickstart -k "${SERVICE_TARGET}"

echo "Installed and started ${LABEL}"
echo "Model URL: http://127.0.0.1:43113/v1"
echo "Logs:"
echo "  ${LOG_DIR}/transparker.out.log"
echo "  ${LOG_DIR}/transparker.err.log"
