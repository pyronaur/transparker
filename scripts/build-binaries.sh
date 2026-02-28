#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
OUT_DIR="${PROJECT_DIR}/dist/bin"
ENTRYPOINT="${PROJECT_DIR}/src/server.ts"

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required to build binaries. Install from https://bun.sh"
  exit 1
fi

mkdir -p "${OUT_DIR}"

targets=(
  "bun-darwin-arm64 transparker-darwin-arm64 (arm64|aarch64)"
  "bun-darwin-x64 transparker-darwin-x64 (x86_64|x86-64|amd64)"
  "bun-linux-arm64 transparker-linux-arm64 (arm64|aarch64)"
  "bun-linux-arm64-musl transparker-linux-arm64-musl (arm64|aarch64)"
  "bun-linux-x64 transparker-linux-x64 (x86_64|x86-64|amd64)"
  "bun-linux-x64-musl transparker-linux-x64-musl (x86_64|x86-64|amd64)"
)

for row in "${targets[@]}"; do
  target="$(echo "${row}" | awk '{print $1}')"
  name="$(echo "${row}" | awk '{print $2}')"
  expected_arch_pattern="$(echo "${row}" | awk '{print $3}')"
  outfile="${OUT_DIR}/${name}"

  echo "Building ${name} (${target})"
  bun build \
    --compile \
    --target="${target}" \
    --outfile="${outfile}" \
    "${ENTRYPOINT}"

  chmod +x "${outfile}"

  file_output="$(file "${outfile}")"
  if ! echo "${file_output}" | grep -Eq "${expected_arch_pattern}"; then
    echo "Unexpected architecture for ${outfile}: ${file_output}"
    exit 1
  fi
done

echo
echo "Binaries built:"
ls -lh "${OUT_DIR}"
