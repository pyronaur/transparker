import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parseBooleanish, parseInteger } from "./parsing";

export interface FileBackedAppDefaults {
	readonly host: string;
	readonly port: number;
	readonly logLevel: string;
	readonly logFullTranscripts: boolean;
	readonly modelId: string;
	readonly modelOwner: string;
}

export interface FileBackedCodexDefaults {
	readonly codexBin: string;
	readonly model: string;
	readonly reasoningEffort: "low" | "medium" | "high";
	readonly timeoutMs: number;
	readonly codexHomeDir: string;
	readonly codexUserHomeDir: string;
	readonly globalAuthFile: string;
	readonly wordlistFile: string;
	readonly codexConfigFile: string;
	readonly promptFile: string;
	readonly outputSchemaFile: string;
}

export interface FileBackedDefaults {
	readonly homeDir: string;
	readonly configFile: string;
	readonly app: FileBackedAppDefaults;
	readonly codex: FileBackedCodexDefaults;
}

interface RawConfig {
	readonly host?: unknown;
	readonly port?: unknown;
	readonly log_level?: unknown;
	readonly log_full_transcripts?: unknown;
	readonly model_id?: unknown;
	readonly model_owner?: unknown;
	readonly wordlist_file?: unknown;
	readonly codex?: unknown;
}

interface RawCodexConfig {
	readonly bin?: unknown;
	readonly model?: unknown;
	readonly reasoning_effort?: unknown;
	readonly timeout_ms?: unknown;
	readonly home_dir?: unknown;
	readonly user_home_dir?: unknown;
	readonly global_auth_file?: unknown;
	readonly config_file?: unknown;
	readonly prompt_file?: unknown;
	readonly output_schema_file?: unknown;
}

const DEFAULT_HOME_DIR = "~/.transparker";
const DEFAULT_PROMPT_FALLBACK = "{{TRANSCRIPT}}\n";
const DEFAULT_WORDLIST_FALLBACK = "transparker\n";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asInteger(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isInteger(value)) {
		return value;
	}
	if (typeof value === "string") {
		return parseInteger(value);
	}
	return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
	if (typeof value === "boolean") {
		return value;
	}
	if (typeof value === "string") {
		return parseBooleanish(value);
	}
	return undefined;
}

function parseReasoningEffort(value: unknown): "low" | "medium" | "high" | undefined {
	if (value === "low" || value === "medium" || value === "high") {
		return value;
	}
	return undefined;
}

function describeValue(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	const serialized = JSON.stringify(value);
	return serialized ?? "<unserializable>";
}

function parsePortFromConfig(value: unknown, configFile: string): number | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}

	const parsed = asInteger(value);
	if (parsed === undefined || parsed < 1 || parsed > 65535) {
		throw new Error(
			`Invalid port in Transparker config at ${configFile}: "${describeValue(value)}"`,
		);
	}

	return parsed;
}

function expandPath(pathLike: string, baseDir: string): string {
	if (pathLike === "~") {
		return homedir();
	}
	if (pathLike.startsWith("~/")) {
		return join(homedir(), pathLike.slice(2));
	}
	if (isAbsolute(pathLike)) {
		return pathLike;
	}
	return resolve(baseDir, pathLike);
}

function ensureDir(path: string): void {
	mkdirSync(path, { recursive: true });
}

function ensureFile(path: string, content: string): void {
	if (existsSync(path)) {
		return;
	}
	ensureDir(dirname(path));
	writeFileSync(path, content, "utf8");
}

function readSeedFile(path: string, fallback: string): string {
	if (!existsSync(path)) {
		return fallback;
	}
	try {
		return readFileSync(path, "utf8");
	} catch {
		return fallback;
	}
}

function buildDefaultConfigToml(homeDir: string): string {
	const codexDir = join(homeDir, "codex");
	const lines = [
		"host = \"127.0.0.1\"",
		"port = 43113",
		"log_level = \"info\"",
		"log_full_transcripts = false",
		"model_id = \"Transparker\"",
		"model_owner = \"transparker-local\"",
		`wordlist_file = "${join(homeDir, "wordlist.md")}"`,
		"",
		"[codex]",
		"bin = \"codex\"",
		"model = \"gpt-5.3-codex-spark\"",
		"reasoning_effort = \"low\"",
		"timeout_ms = 120000",
		`home_dir = "${codexDir}"`,
		`user_home_dir = "${join(codexDir, ".home")}"`,
		`global_auth_file = "${join(homedir(), "codex/auth.json")}"`,
		`config_file = "${join(codexDir, "config.toml")}"`,
		`prompt_file = "${join(homeDir, "prompt.md")}"`,
		`output_schema_file = "${join(codexDir, "output.schema.json")}"`,
	];

	return `${lines.join("\n")}\n`;
}

function parseConfigFile(path: string): RawConfig {
	let raw = "";
	try {
		raw = readFileSync(path, "utf8");
	} catch (error) {
		throw new Error(
			`Failed reading Transparker config at ${path}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}

	try {
		const parsed = Bun.TOML.parse(raw);
		return isRecord(parsed) ? (parsed as RawConfig) : {};
	} catch (error) {
		throw new Error(
			`Invalid TOML in Transparker config at ${path}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}

export function loadTransparkerFileDefaults(
	env: NodeJS.ProcessEnv = process.env,
): FileBackedDefaults {
	const projectRoot = resolve(env.TRANSPARKER_PROJECT_ROOT ?? process.cwd());
	const homeDir = expandPath(env.TRANSPARKER_HOME_DIR ?? DEFAULT_HOME_DIR, process.cwd());
	const configFile = expandPath(
		env.TRANSPARKER_CONFIG_FILE ?? join(homeDir, "config.toml"),
		process.cwd(),
	);

	ensureDir(homeDir);
	ensureFile(configFile, buildDefaultConfigToml(homeDir));

	const rawConfig = parseConfigFile(configFile);
	const rawCodex = isRecord(rawConfig.codex) ? (rawConfig.codex as RawCodexConfig) : {};
	const configDir = dirname(configFile);

	const defaultWordlistPath = join(homeDir, "wordlist.md");
	const defaultPromptPath = join(homeDir, "prompt.md");
	const defaultCodexDir = join(homeDir, "codex");

	const wordlistPath = expandPath(asString(rawConfig.wordlist_file) ?? defaultWordlistPath,
		configDir);
	const promptPath = expandPath(asString(rawCodex.prompt_file) ?? defaultPromptPath, configDir);

	const seededWordlist = readSeedFile(resolve(projectRoot, "WORDLIST.md"),
		DEFAULT_WORDLIST_FALLBACK);
	const seededPrompt = readSeedFile(resolve(projectRoot, "PROMPT.md"), DEFAULT_PROMPT_FALLBACK);
	ensureFile(wordlistPath, seededWordlist);
	ensureFile(promptPath, seededPrompt);

	const appDefaults: FileBackedAppDefaults = {
		host: asString(rawConfig.host) ?? "127.0.0.1",
		port: parsePortFromConfig(rawConfig.port, configFile) ?? 43113,
		logLevel: asString(rawConfig.log_level) ?? "info",
		logFullTranscripts: asBoolean(rawConfig.log_full_transcripts) ?? false,
		modelId: asString(rawConfig.model_id) ?? "Transparker",
		modelOwner: asString(rawConfig.model_owner) ?? "transparker-local",
	};

	const reasoningEffort = parseReasoningEffort(rawCodex.reasoning_effort) ?? "low";
	const timeoutMs = asInteger(rawCodex.timeout_ms);

	const codexDefaults: FileBackedCodexDefaults = {
		codexBin: asString(rawCodex.bin) ?? "codex",
		model: asString(rawCodex.model) ?? "gpt-5.3-codex-spark",
		reasoningEffort,
		timeoutMs: timeoutMs && timeoutMs > 0 ? timeoutMs : 120_000,
		codexHomeDir: expandPath(asString(rawCodex.home_dir) ?? defaultCodexDir, configDir),
		codexUserHomeDir: expandPath(
			asString(rawCodex.user_home_dir) ?? join(defaultCodexDir, ".home"),
			configDir,
		),
		globalAuthFile: expandPath(
			asString(rawCodex.global_auth_file) ?? join(homedir(), "codex/auth.json"),
			configDir,
		),
		wordlistFile: wordlistPath,
		codexConfigFile: expandPath(
			asString(rawCodex.config_file) ?? join(defaultCodexDir, "config.toml"),
			configDir,
		),
		promptFile: promptPath,
		outputSchemaFile: expandPath(
			asString(rawCodex.output_schema_file) ?? join(defaultCodexDir, "output.schema.json"),
			configDir,
		),
	};

	return {
		homeDir,
		configFile,
		app: appDefaults,
		codex: codexDefaults,
	};
}
