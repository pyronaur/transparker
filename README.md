# Transparker: Use Codex CLI to Clean Handy.app Transcripts

Transparker is only for post-processing transcriptions from [Handy App](https://handy.computer) with Codex.

![Handy post-processing setup screenshot](https://raw.githubusercontent.com/pyronaur/transparker/main/screen.jpg)

Transparker is a small local Bun.js service that lets Handy use Codex CLI specifically for transcript post-processing.
It gives Handy an OpenAI-compatible local endpoint, runs correction with your Codex auth/subscription, and returns cleaned text in `chat.completions` format.

## Value

- Use Codex CLI only for post-processing transcript correction from Handy.
- Avoid wiring an OpenAI API key into Handy for this workflow.
- Keep behavior editable with `codex/AGENTS.md`, `~/.transparker/config.toml`, `~/.transparker/prompt.md`, and `~/.transparker/wordlist.md`.
- Run it as a persistent user service so it is always available (`launchd` on macOS, `systemd --user` on Linux).
- Install globally with `npm` or `bun` while running on Bun runtime (embedded in binary builds).

## How It Works

- Handy sends transcript text to `POST /v1/chat/completions`.
- Transparker calls `codex` with your local auth (`~/.transparker/codex/auth.json`, optionally symlinked from `TRANSPARKER_GLOBAL_AUTH_FILE`).
- Transparker returns an OpenAI-shaped response with the cleaned transcript.
- `OPENAI_API_KEY` is intentionally ignored by this runtime path.
- The service is locally hosted, but Codex processing still depends on Codex backend/auth.

## Quick Start (Global Install, macOS or Linux)

Requirements:
- macOS or Linux
- `codex` CLI installed and authenticated
- `npm` or `bun` package manager

Install:

```bash
npm install -g transparker
# or
bun install -g transparker
```

Install and start the service:

```bash
transparker install-service
```

Verify health:

```bash
curl -fsS "http://127.0.0.1:43113/healthz"
```

Supported global-install platforms:
- macOS arm64
- macOS x64
- Linux arm64 (glibc + musl)
- Linux x64 (glibc + musl)

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

Transparker uses file-first config in `~/.transparker/config.toml`.
If missing, Transparker auto-creates:
- `~/.transparker/config.toml`
- `~/.transparker/wordlist.md`
- `~/.transparker/prompt.md`

Environment variables remain available and override config file values.

Default `~/.transparker/config.toml`:

```toml
host = "127.0.0.1"
port = 43113
log_level = "info"
log_full_transcripts = false
model_id = "Transparker"
model_owner = "transparker-local"
wordlist_file = "/Users/<you>/.transparker/wordlist.md"

[codex]
bin = "codex"
model = "gpt-5.3-codex-spark"
reasoning_effort = "low"
timeout_ms = 120000
home_dir = "/Users/<you>/.transparker/codex"
user_home_dir = "/Users/<you>/.transparker/codex/.home"
global_auth_file = "/Users/<you>/codex/auth.json"
config_file = "/Users/<you>/.transparker/codex/config.toml"
prompt_file = "/Users/<you>/.transparker/prompt.md"
output_schema_file = "/Users/<you>/.transparker/codex/output.schema.json"
```

### Prompt and Wordlist Files

- `~/.transparker/prompt.md`: template containing `{{KNOWN_DOMAIN_TERMS}}` and `{{TRANSCRIPT}}`.
- `~/.transparker/wordlist.md`: domain terms injected into each request (one term per line).
- `codex/AGENTS.md`: canonical Codex instruction file loaded from `CODEX_HOME`.

### Codex Runtime and Auth

- Codex runs with `CODEX_HOME=~/.transparker/codex` by default.
- Transparker uses `~/.transparker/codex/auth.json`.
- If local auth is absent and `TRANSPARKER_GLOBAL_AUTH_FILE` exists, Transparker creates a symlink.
- `OPENAI_API_KEY` is ignored by this runtime path.

### Optional Environment Overrides

- `TRANSPARKER_HOME_DIR` (default `~/.transparker`)
- `TRANSPARKER_CONFIG_FILE` (default `~/.transparker/config.toml`)
- `HOST`, `PORT`, `LOG_LEVEL`, `TRANSPARKER_LOG_FULL_TRANSCRIPTS`
- `TRANSPARKER_MODEL_ID`, `TRANSPARKER_MODEL_OWNER`
- `TRANSPARKER_CODEX_MODEL`, `TRANSPARKER_CODEX_BIN`, `TRANSPARKER_CODEX_REASONING_EFFORT`, `TRANSPARKER_CODEX_TIMEOUT_MS`
- `TRANSPARKER_CODEX_HOME_DIR`, `TRANSPARKER_CODEX_USER_HOME_DIR`, `TRANSPARKER_GLOBAL_AUTH_FILE`
- `TRANSPARKER_WORDLIST_FILE`, `TRANSPARKER_PROMPT_FILE`, `TRANSPARKER_CODEX_CONFIG_FILE`, `TRANSPARKER_CODEX_OUTPUT_SCHEMA_FILE`

Service reload workflow:
1. Edit `~/.transparker/config.toml`.
2. Reload:

macOS:

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.transparker.api.plist 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.transparker.api.plist
launchctl kickstart -k gui/$(id -u)/com.transparker.api
```

Linux:

```bash
systemctl --user daemon-reload
systemctl --user restart transparker.service
```

Manual run workflow:

```bash
transparker
```

Manual run from source checkout:

```bash
bun run start
```

## Service Management

Install/start service:

```bash
transparker install-service
```

Restart service:

```bash
transparker restart-service
```

Uninstall service:

```bash
transparker uninstall-service
```

Check service state (macOS):

```bash
launchctl print gui/$(id -u)/com.transparker.api | rg "state =|pid ="
```

Check service state (Linux):

```bash
systemctl --user status transparker.service --no-pager
```

## Logs and Debug Mode

Log files:
- `~/Library/Logs/Transparker/transparker.out.log`
- `~/Library/Logs/Transparker/transparker.err.log`
- Linux logs via `journalctl --user -u transparker.service`

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

Linux log tail:

```bash
journalctl --user -u transparker.service -f
```

## Development

Development from source requires [Bun](https://bun.sh).

Install, test, and enable auto-launch from source checkout:

```bash
bun run install:local
```

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
