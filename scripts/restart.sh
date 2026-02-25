#!/usr/bin/env bash
set -euo pipefail

LABEL="com.transparker.api"
SERVICE_TARGET="gui/$(id -u)/${LABEL}"

launchctl kickstart -k "${SERVICE_TARGET}"
launchctl print "${SERVICE_TARGET}" | rg "state =|pid =" || true
