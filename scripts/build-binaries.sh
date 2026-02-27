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
  "bun-darwin-arm64 transparker-darwin-arm64 arm64"
  "bun-darwin-x64 transparker-darwin-x64 x86_64"
)

for row in "${targets[@]}"; do
  target="$(echo "${row}" | awk '{print $1}')"
  name="$(echo "${row}" | awk '{print $2}')"
  expected_arch="$(echo "${row}" | awk '{print $3}')"
  outfile="${OUT_DIR}/${name}"

  echo "Building ${name} (${target})"
  bun build \
    --compile \
    --target="${target}" \
    --outfile="${outfile}" \
    "${ENTRYPOINT}"

  chmod +x "${outfile}"

  file_output="$(file "${outfile}")"
  if [[ "${file_output}" != *"${expected_arch}"* ]]; then
    echo "Unexpected architecture for ${outfile}: ${file_output}"
    exit 1
  fi
done

echo
echo "Binaries built:"
ls -lh "${OUT_DIR}"
