---
summary: "Local binary build and release verification flow for transparker maintainers"
read_when:
  - Publishing a new transparker package version from a local machine.
  - Verifying which binaries are built and shipped.
  - Running Linux smoke checks in OrbStack before a release.
---

# Publishing

This repository uses a local publish flow.

## What gets built

`bun run build:bin` runs `scripts/build-binaries.sh` and creates:

- `dist/bin/transparker-darwin-arm64`
- `dist/bin/transparker-darwin-x64`
- `dist/bin/transparker-linux-arm64`
- `dist/bin/transparker-linux-arm64-musl`
- `dist/bin/transparker-linux-x64`
- `dist/bin/transparker-linux-x64-musl`

The script validates each output architecture with `file`.

## Local release checklist

Run from repository root.

1. Install dependencies:

```bash
bun install
```

2. Run checks:

```bash
make lint
bun run test
```

3. Build release binaries:

```bash
bun run build:bin
```

4. Verify generated binaries:

```bash
ls -1 dist/bin/transparker-*
file dist/bin/transparker-*
```

5. Run the private credentialed release runbook from `~/.nconf/docs/`.

## Post-release smoke test

On a clean shell/session:

```bash
transparker help
```

Optional service validation:

```bash
transparker install-service
curl -fsS "http://127.0.0.1:43113/healthz"
```

## OrbStack Linux smoke test

Run Linux binary smoke test in an OrbStack container:

```bash
docker run --rm -it -v "$PWD:/work" -w /work ubuntu:24.04 bash -lc '
  apt-get update &&
  apt-get install -y ca-certificates &&
  chmod +x ./dist/bin/transparker-linux-x64 &&
  ./dist/bin/transparker-linux-x64 help
'
```

## Public repo safety

Do not commit personal auth or local runtime files.
Keep secrets and machine-specific config in `~/.transparker/`.
