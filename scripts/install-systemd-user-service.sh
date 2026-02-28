#!/usr/bin/env bash
set -euo pipefail

UNIT_NAME="transparker.service"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEMPLATE_PATH="${PROJECT_DIR}/systemd/transparker.service"
TARGET_DIR="${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user"
TARGET_PATH="${TARGET_DIR}/${UNIT_NAME}"
WORKING_DIR="${TRANSPARKER_WORKING_DIR:-${HOME}}"

escape_sed_replacement() {
  printf '%s' "${1}" | sed -e 's/[&|]/\\&/g'
}

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

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl is required for Linux service management."
  echo "Fallback: run transparker in the foreground with: transparker"
  exit 1
fi

if ! systemctl --user show-environment >/dev/null 2>&1; then
  echo "systemd user manager is unavailable for this session."
  echo "Fallback: run transparker in the foreground with: transparker"
  exit 1
fi

mkdir -p "${TARGET_DIR}"

TRANSPARKER_BIN_ESCAPED="$(escape_sed_replacement "${TRANSPARKER_BIN}")"
WORKING_DIR_ESCAPED="$(escape_sed_replacement "${WORKING_DIR}")"

sed \
  -e "s|__TRANSPARKER_BIN__|${TRANSPARKER_BIN_ESCAPED}|g" \
  -e "s|__WORKING_DIR__|${WORKING_DIR_ESCAPED}|g" \
  "${TEMPLATE_PATH}" > "${TARGET_PATH}"

systemctl --user daemon-reload
systemctl --user enable --now "${UNIT_NAME}"
systemctl --user status "${UNIT_NAME}" --no-pager | grep -E "Loaded:|Active:|Main PID:" || true

echo "Installed and started ${UNIT_NAME}"
echo "Model URL: http://127.0.0.1:43113/v1"
echo "Logs: journalctl --user -u ${UNIT_NAME} -f"
