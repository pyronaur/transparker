# Transparker: Use Codex CLI to Clean Handy.app Transcripts

Transparker is a small local Bun.js service that lets Handy.app use Codex CLI for transcript cleanup.
It gives Handy an OpenAI-compatible local endpoint, runs correction with your Codex auth/subscription, and returns cleaned text in `chat.completions` format.

## Value

- Use Codex CLI for transcript correction from Handy.app.
- Avoid wiring an OpenAI API key into Handy for this workflow.
- Keep prompt behavior editable with `codex/AGENTS.md`, `PROMPT.md`, and `WORDLIST.md`.
- Run it as a persistent macOS LaunchAgent so it is always available.

## How It Works

- Handy sends transcript text to `POST /v1/chat/completions`.
- Transparker calls `codex` with your local auth (`./codex/auth.json`, optionally symlinked from `TRANSPARKER_GLOBAL_AUTH_FILE`).
- Transparker returns an OpenAI-shaped response with the cleaned transcript.
- `OPENAI_API_KEY` is intentionally ignored by this runtime path.
- The service is locally hosted, but Codex processing still depends on Codex backend/auth.

## Quick Start (macOS)

Requirements:
- macOS
- [Bun](https://bun.sh)
- `codex` CLI installed and authenticated

Install, test, and enable auto-launch:

```bash
bun run install:local
```

`install:local` will:
- install dependencies
- run typecheck and tests
- install and start the LaunchAgent
- verify `http://127.0.0.1:43113/healthz`

## Handy.app Setup

Use these values in Handy.app:
- Provider: `Custom`
- Base URL: `http://127.0.0.1:43113/v1`
- Model: `Transparker`
- API key: leave blank (not required for this local adapter)

## OpenAI-Compatible API Endpoints

- `GET /healthz`
- `GET /v1/models`
- `POST /v1/chat/completions` (streaming not implemented)

`/v1/models` advertises the configured model id (default `Transparker`) for model pickers.

## Configuration

Default environment values:
- `HOST=127.0.0.1`
- `PORT=43113`
- `TRANSPARKER_MODEL_ID=Transparker`
- `TRANSPARKER_MODEL_OWNER=transparker-local`
- `LOG_LEVEL=info`
- `TRANSPARKER_LOG_FULL_TRANSCRIPTS=false`
- `TRANSPARKER_CODEX_MODEL=gpt-5.3-codex-spark`
- `TRANSPARKER_CODEX_BIN=codex`
- `TRANSPARKER_CODEX_REASONING_EFFORT=low`
- `TRANSPARKER_CODEX_TIMEOUT_MS=120000`
- `TRANSPARKER_CODEX_HOME_DIR=./codex`
- `TRANSPARKER_CODEX_USER_HOME_DIR=./codex/.home`
- `TRANSPARKER_GLOBAL_AUTH_FILE=~/codex/auth.json`
- `TRANSPARKER_WORDLIST_FILE=./WORDLIST.md`
- `TRANSPARKER_CODEX_CONFIG_FILE=./codex/config.toml`
- `TRANSPARKER_PROMPT_FILE=./PROMPT.md`
- `TRANSPARKER_CODEX_OUTPUT_SCHEMA_FILE=./codex/output.schema.json`

### Prompt and Wordlist Files

- `codex/AGENTS.md`: canonical Codex instruction file.
- `PROMPT.md`: template containing `{{KNOWN_DOMAIN_TERMS}}` and `{{TRANSCRIPT}}`.
- `WORDLIST.md`: domain terms injected into each request.

### Codex Runtime and Auth

- Codex runs with `CODEX_HOME=./codex`.
- AGENTS instructions are loaded from project-local `CODEX_HOME`.
- Transparker uses `./codex/auth.json`.
- If `./codex/auth.json` is absent and `TRANSPARKER_GLOBAL_AUTH_FILE` exists, Transparker creates a symlink.
- `OPENAI_API_KEY` is ignored by this runtime path.

### Model Selection

- Set `TRANSPARKER_CODEX_MODEL` to choose the Codex model.
- Set `TRANSPARKER_CODEX_REASONING_EFFORT` to `low`, `medium`, or `high`.

LaunchAgent workflow:
1. Edit `~/Library/LaunchAgents/com.transparker.api.plist` in `EnvironmentVariables`.
2. Update `TRANSPARKER_CODEX_MODEL` and/or `TRANSPARKER_CODEX_REASONING_EFFORT`.
3. Reload:

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.transparker.api.plist 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.transparker.api.plist
launchctl kickstart -k gui/$(id -u)/com.transparker.api
```

Manual run workflow:

```bash
export TRANSPARKER_CODEX_MODEL=gpt-5.3-codex-spark
export TRANSPARKER_CODEX_REASONING_EFFORT=low
bun run start
```

## macOS Service Management

Install/start LaunchAgent:

```bash
./scripts/install-launch-agent.sh
```

Restart service:

```bash
./scripts/restart.sh
```

Uninstall LaunchAgent:

```bash
./scripts/uninstall-launch-agent.sh
```

Check service state:

```bash
launchctl print gui/$(id -u)/com.transparker.api | rg "state =|pid ="
```

## Logs and Debug Mode

Log files:
- `~/Library/Logs/Transparker/transparker.out.log`
- `~/Library/Logs/Transparker/transparker.err.log`

Enable full transcript debug logging:
- `LOG_LEVEL=debug`
- `TRANSPARKER_LOG_FULL_TRANSCRIPTS=true`

When enabled, request logs include:
- `transcript_received.input_full`
- `transcript_processed.output_full`

Tail logs:

```bash
tail -f ~/Library/Logs/Transparker/transparker.out.log
```

## Development

Run with watch mode:

```bash
bun run dev
```

Run checks:

```bash
bun run check
bun run test
```

Transcript processing entrypoint:
- `src/processor/processTranscript.ts`
