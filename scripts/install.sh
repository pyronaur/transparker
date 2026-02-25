#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_DIR}"

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required. Install from https://bun.sh"
  exit 1
fi

echo "1) Installing dependencies"
bun install

echo
echo "2) Running typecheck + tests"
bun run check
bun run test

echo
echo "3) Installing launch agent"
"${SCRIPT_DIR}/install-launch-agent.sh"

echo
echo "4) Verifying health endpoint"
health_ok=0
for _ in {1..30}; do
  if curl -fsS "http://127.0.0.1:43113/healthz" >/dev/null 2>&1; then
    health_ok=1
    break
  fi
  sleep 0.5
done

if [[ "${health_ok}" -ne 1 ]]; then
  echo "Health check failed: could not reach http://127.0.0.1:43113/healthz"
  launchctl print "gui/$(id -u)/com.transparker.api" | rg "state =|pid =|last exit code =" || true
  exit 1
fi

curl -fsS "http://127.0.0.1:43113/healthz"
echo
echo
echo "Install complete."
echo "Handy Base URL: http://127.0.0.1:43113/v1"
echo "Model: Transparker"
