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
WORKING_DIR="${TRANSPARKER_WORKING_DIR:-${HOME}}"

if [[ -n "${TRANSPARKER_BIN_PATH:-}" ]]; then
  TRANSPARKER_BIN="${TRANSPARKER_BIN_PATH}"
elif [[ -x "${PROJECT_DIR}/npm/bin/transparker" ]]; then
  TRANSPARKER_BIN="${PROJECT_DIR}/npm/bin/transparker"
elif command -v transparker >/dev/null 2>&1; then
  TRANSPARKER_BIN="$(command -v transparker)"
else
  echo "Could not locate transparker binary. Install it globally or set TRANSPARKER_BIN_PATH."
  exit 1
fi

if [[ ! -x "${TRANSPARKER_BIN}" ]]; then
  echo "transparker binary is not executable: ${TRANSPARKER_BIN}"
  exit 1
fi

mkdir -p "${TARGET_DIR}" "${LOG_DIR}"

sed \
  -e "s|__TRANSPARKER_BIN__|${TRANSPARKER_BIN}|g" \
  -e "s|__WORKING_DIR__|${WORKING_DIR}|g" \
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
