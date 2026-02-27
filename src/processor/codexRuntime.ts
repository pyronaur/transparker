import { resolve } from "node:path";
import { type FileBackedCodexDefaults, loadTransparkerFileDefaults } from "../fileConfig";
import { parseInteger } from "../parsing";

export type CodexRuntimeConfig = {
	readonly projectRoot: string;
} & FileBackedCodexDefaults;

export interface CodexExecInput {
	readonly codexBin: string;
	readonly cwd: string;
	readonly env: Record<string, string | undefined>;
	readonly model: string;
	readonly schemaPath: string;
	readonly promptPath: string;
	readonly jsonOutputPath: string;
	readonly abortSignal?: AbortSignal;
}

export interface CodexRuntimeLogger {
	info(message: string, meta?: Record<string, unknown>): void;
	error(message: string, meta?: Record<string, unknown>): void;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
	const parsed = parseInteger(raw);
	if (parsed === undefined) {
		return fallback;
	}
	if (parsed <= 0) {
		return fallback;
	}
	return parsed;
}

function parseReasoningEffort(raw: string | undefined): "low" | "medium" | "high" {
	if (raw === "low" || raw === "medium" || raw === "high") {
		return raw;
	}
	return "low";
}

export function loadCodexRuntimeConfig(env: NodeJS.ProcessEnv = process.env): CodexRuntimeConfig {
	const fileDefaults = loadTransparkerFileDefaults(env);
	const projectRoot = resolve(env.TRANSPARKER_PROJECT_ROOT ?? process.cwd());

	return {
		projectRoot,
		codexBin: env.TRANSPARKER_CODEX_BIN ?? fileDefaults.codex.codexBin,
		model: env.TRANSPARKER_CODEX_MODEL ?? fileDefaults.codex.model,
		reasoningEffort: parseReasoningEffort(
			env.TRANSPARKER_CODEX_REASONING_EFFORT ?? fileDefaults.codex.reasoningEffort,
		),
		timeoutMs: parsePositiveInt(env.TRANSPARKER_CODEX_TIMEOUT_MS, fileDefaults.codex.timeoutMs),
		codexHomeDir: env.TRANSPARKER_CODEX_HOME_DIR ?? fileDefaults.codex.codexHomeDir,
		codexUserHomeDir: env.TRANSPARKER_CODEX_USER_HOME_DIR ?? fileDefaults.codex.codexUserHomeDir,
		globalAuthFile: env.TRANSPARKER_GLOBAL_AUTH_FILE ?? fileDefaults.codex.globalAuthFile,
		wordlistFile: env.TRANSPARKER_WORDLIST_FILE ?? fileDefaults.codex.wordlistFile,
		codexConfigFile: env.TRANSPARKER_CODEX_CONFIG_FILE ?? fileDefaults.codex.codexConfigFile,
		promptFile: env.TRANSPARKER_PROMPT_FILE ?? fileDefaults.codex.promptFile,
		outputSchemaFile: env.TRANSPARKER_CODEX_OUTPUT_SCHEMA_FILE
			?? fileDefaults.codex.outputSchemaFile,
	};
}

export { CodexRuntimeError, processWithCodex } from "./codexProcess";
export { buildPrompt } from "./codexPrompt";
