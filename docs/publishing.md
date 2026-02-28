---
summary: "Local binary build and npm publish flow for transparker maintainers"
read_when:
  - Publishing a new transparker package version from a local machine.
  - Verifying which binaries are built and shipped to npm.
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

## What gets shipped

`package.json` includes these relevant publish settings:

- `scripts.prepack = "bun run build:bin"`
- `files` includes `dist/bin/*`, `npm/bin/transparker`, and service assets for macOS/Linux

Because of `prepack`, `npm pack` and `npm publish` rebuild binaries before packaging.

## Local publish checklist

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

3. Verify the package payload before publishing:

```bash
npm pack --dry-run
```

4. Publish to npm:

```bash
npm publish
```

## Post-publish smoke test

On a clean shell/session:

```bash
npm install -g transparker
transparker help
```

Optional service validation:

```bash
transparker install-service
curl -fsS "http://127.0.0.1:43113/healthz"
```

## OrbStack Linux smoke test

Build and inspect package tarball locally:

```bash
npm pack
```

Install and run in a Linux container using OrbStack’s Docker runtime:

```bash
docker run --rm -it -v "$PWD:/work" -w /work ubuntu:24.04 bash -lc '
  apt-get update &&
  apt-get install -y curl ca-certificates npm &&
  npm install -g ./transparker-<version>.tgz &&
  transparker help
'
```

Optional Linux service smoke test (when `systemd --user` is available in the container/session):

```bash
transparker install-service
systemctl --user status transparker.service --no-pager
```

## Public repo safety

Do not commit personal auth or local runtime files.
Keep secrets and machine-specific config in `~/.transparker/`.
