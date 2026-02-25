# Transparker Local API

Transparker is a local Bun service that exposes a purpose-built OpenAI-compatible API for Handy.app post-processing.

It is designed for a simple workflow:
- Handy sends transcript text to a local endpoint.
- Transparker returns corrected text in `chat.completions` response format.
- The service runs automatically on macOS login via `launchd`.

## Quick Start

Requirements:
- macOS
- [Bun](https://bun.sh) installed

Install and enable the local service:

```bash
bun run install:local
```

This command:
- installs dependencies
- runs checks/tests
- installs/starts the LaunchAgent
- verifies `http://127.0.0.1:43113/healthz`

## Handy.app Configuration

Use the following values in Handy:
- Provider: `Custom`
- Base URL: `http://127.0.0.1:43113/v1`
- Model: `Transparker`
- API key: optional for local use

## API Surface

- `GET /healthz`
- `GET /v1/models`
- `POST /v1/chat/completions` (non-streaming only)

`/v1/models` returns `Transparker` so it appears in OpenAI-compatible model pickers.

## Configuration

Environment defaults:
- `HOST=127.0.0.1`
- `PORT=43113`
- `TRANSPARKER_MODEL_ID=Transparker`
- `TRANSPARKER_MODEL_OWNER=transparker-local`
- `LOG_LEVEL=info`

## macOS Service Management

Install/start LaunchAgent:

```bash
./scripts/install-launch-agent.sh
```

Restart after code changes:

```bash
./scripts/restart.sh
```

Uninstall LaunchAgent:

```bash
./scripts/uninstall-launch-agent.sh
```

Service status:

```bash
launchctl print gui/$(id -u)/com.transparker.api | rg "state =|pid ="
```

Logs:
- `~/Library/Logs/Transparker/transparker.out.log`
- `~/Library/Logs/Transparker/transparker.err.log`

Live log tail:

```bash
tail -f ~/Library/Logs/Transparker/transparker.out.log
```

## Development

Run in watch mode:

```bash
bun run dev
```

Run checks:

```bash
bun run check
bun run test
```

Text processing entrypoint:
- `src/processor/processTranscript.ts`
