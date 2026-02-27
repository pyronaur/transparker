import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { type CodexExecOutput, runCodexCommand } from "./codexExec";
import { buildPrompt } from "./codexPrompt";
import type { CodexExecInput, CodexRuntimeConfig, CodexRuntimeLogger } from "./codexRuntime";
import { collectSessionDiagnostics } from "./codexSessionDiagnostics";

const DEFAULT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["cleaned_transcript"],
	properties: {
		cleaned_transcript: {
			type: "string",
		},
	},
} as const;

interface ProcessOptions {
	readonly transcript: string;
	readonly config: CodexRuntimeConfig;
	readonly logger: CodexRuntimeLogger;
	readonly requestId?: string;
	readonly execCodex?: (input: CodexExecInput) => Promise<CodexExecOutput>;
}

interface RuntimePaths {
	readonly projectRoot: string;
	readonly promptPath: string;
	readonly wordlistPath: string;
	readonly codexHomePath: string;
	readonly codexUserHomePath: string;
	readonly codexConfigPath: string;
	readonly schemaPath: string;
}

interface PreparedRun {
	readonly paths: RuntimePaths;
	readonly requestMeta: Record<string, unknown>;
	readonly tempDir: string;
	readonly promptFilePath: string;
	readonly jsonOutputPath: string;
	readonly startedAt: number;
	readonly pipelineStartedAt: number;
}

interface ExecutionContext {
	readonly options: ProcessOptions;
	readonly prepared: PreparedRun;
}

function resolvePath(projectRoot: string, pathLike: string): string {
	if (pathLike.startsWith("~/")) {
		return join(homedir(), pathLike.slice(2));
	}
	return pathLike.startsWith("/") ? pathLike : resolve(projectRoot, pathLike);
}

function isBlank(text: string): boolean {
	return text.trim().length === 0;
}

function resolveRuntimePaths(config: CodexRuntimeConfig): RuntimePaths {
	const projectRoot = config.projectRoot;
	return {
		projectRoot,
		promptPath: resolvePath(projectRoot, config.promptFile),
		wordlistPath: resolvePath(projectRoot, config.wordlistFile),
		codexHomePath: resolvePath(projectRoot, config.codexHomeDir),
		codexUserHomePath: resolvePath(projectRoot, config.codexUserHomeDir),
		codexConfigPath: resolvePath(projectRoot, config.codexConfigFile),
		schemaPath: resolvePath(projectRoot, config.outputSchemaFile),
	};
}

function buildRequestMeta(requestId: string | undefined): Record<string, unknown> {
	return requestId ? { request_id: requestId } : {};
}

async function collectSkillFiles(rootDir: string): Promise<string[]> {
	const entries = await readdir(rootDir, { withFileTypes: true });
	const out: string[] = [];

	for (const entry of entries) {
		const fullPath = join(rootDir, entry.name);
		if (entry.isDirectory()) {
			out.push(...(await collectSkillFiles(fullPath)));
			continue;
		}
		if (entry.isFile() && entry.name === "SKILL.md") {
			out.push(fullPath);
		}
	}

	return out;
}

async function writeCodexConfig(
	path: string,
	reasoningEffort: "low" | "medium" | "high",
): Promise<void> {
	const lines = [
		"web_search = \"disabled\"",
		"personality = \"none\"",
		`model_reasoning_effort = "${reasoningEffort}"`,
	];

	const skillsDir = resolve(dirname(path), "skills");
	if (await exists(skillsDir)) {
		const skillFiles = (await collectSkillFiles(skillsDir)).sort();
		for (const skillFile of skillFiles) {
			lines.push("");
			lines.push("[[skills.config]]");
			lines.push(`path = "${skillFile}"`);
			lines.push("enabled = false");
		}
	}

	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${lines.join("\n")}\n`, "utf8");
}

async function ensureAuth(
	config: CodexRuntimeConfig,
	codexHomePath: string,
): Promise<"local_file" | "linked_global_file"> {
	const localAuthPath = resolve(codexHomePath, "auth.json");
	const globalAuthPath = resolvePath(config.projectRoot, config.globalAuthFile);

	if (!(await exists(localAuthPath)) && (await exists(globalAuthPath))) {
		try {
			await symlink(globalAuthPath, localAuthPath);
			return "linked_global_file";
		} catch (error) {
			if (isExistingFileError(error) && (await exists(localAuthPath))) {
				return "local_file";
			}
			throw error;
		}
	}

	if (await exists(localAuthPath)) {
		return "local_file";
	}

	throw new CodexRuntimeError(
		"codex_missing_auth",
		`Missing auth: provide ${globalAuthPath} or ./codex/auth.json.`,
	);
}

function isExistingFileError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	if (!("code" in error)) {
		return false;
	}
	return error.code === "EEXIST";
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function ensureSchema(schemaPath: string): Promise<void> {
	if (await exists(schemaPath)) {
		return;
	}

	await mkdir(dirname(schemaPath), { recursive: true });
	await writeFile(schemaPath, `${JSON.stringify(DEFAULT_SCHEMA, null, 2)}\n`, "utf8");
}

async function withSoftTimeout<T>(
	work: (abortSignal: AbortSignal) => Promise<T>,
	timeoutMs: number,
	onTimeout?: () => void,
): Promise<T> {
	const abortController = new AbortController();
	const workPromise = Promise.resolve().then(() => work(abortController.signal));
	let timedOut = false;
	let timeout: ReturnType<typeof setTimeout> | undefined;

	try {
		const timeoutPromise = new Promise<T>((_, reject) => {
			timeout = setTimeout(() => {
				timedOut = true;
				reject(new CodexRuntimeError("codex_timeout", `Codex timed out after ${timeoutMs}ms.`));
				abortController.abort();
				onTimeout?.();
			}, timeoutMs);
		});
		return await Promise.race([workPromise, timeoutPromise]);
	} finally {
		if (timeout) {
			clearTimeout(timeout);
		}
		if (timedOut) {
			void workPromise.catch(() => {});
		}
	}
}

function textPreview(text: string): string {
	return text.replace(/\s+/g, " ").trim().slice(0, 280);
}

async function readWordlist(path: string): Promise<string> {
	try {
		return await readFile(path, "utf8");
	} catch {
		throw new CodexRuntimeError("codex_wordlist_missing",
			`Missing or unreadable word list file: ${path}.`);
	}
}

function buildChildEnv(
	codexUserHomePath: string,
	codexHomePath: string,
): Record<string, string | undefined> {
	const childEnv: Record<string, string | undefined> = { ...process.env };
	delete childEnv.OPENAI_API_KEY;
	childEnv.HOME = codexUserHomePath;
	childEnv.CODEX_HOME = codexHomePath;
	return childEnv;
}

async function loadCleanedTranscript(jsonOutputPath: string): Promise<string> {
	const rawOutput = await readFile(jsonOutputPath, "utf8");
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawOutput);
	} catch {
		throw new CodexRuntimeError("codex_invalid_json", "Codex output was not valid JSON.");
	}

	if (typeof parsed !== "object" || parsed === null) {
		throw new CodexRuntimeError("codex_invalid_shape", "Codex output JSON must be an object.");
	}

	const cleanedTranscript = Reflect.get(parsed, "cleaned_transcript");
	if (typeof cleanedTranscript !== "string") {
		throw new CodexRuntimeError(
			"codex_invalid_shape",
			"Codex output JSON must contain a string cleaned_transcript field.",
		);
	}

	return cleanedTranscript;
}

async function prepareRun(
	options: ProcessOptions,
	requestMeta: Record<string, unknown>,
	pipelineStartedAt: number,
): Promise<PreparedRun | null> {
	const paths = resolveRuntimePaths(options.config);
	await mkdir(paths.codexHomePath, { recursive: true });

	const promptTemplate = await readFile(paths.promptPath, "utf8");
	if (isBlank(promptTemplate)) {
		options.logger.info("codex_passthrough_blank_prompt", {
			...requestMeta,
			prompt_file: paths.promptPath,
		});
		return null;
	}

	await Promise.all([
		mkdir(paths.codexUserHomePath, { recursive: true }),
		ensureSchema(paths.schemaPath),
	]);
	const wordlistText = await readWordlist(paths.wordlistPath);
	const authMode = await ensureAuth(options.config, paths.codexHomePath);
	await writeCodexConfig(paths.codexConfigPath, options.config.reasoningEffort);

	const tempDir = await mkdtemp(join(tmpdir(), "transparker-codex-"));
	const promptFilePath = resolve(tempDir, "prompt.txt");
	const jsonOutputPath = resolve(tempDir, "output.json");
	const composedPrompt = buildPrompt(promptTemplate, options.transcript, wordlistText);
	await writeFile(promptFilePath, composedPrompt, "utf8");

	options.logger.info("codex_assets_loaded", {
		...requestMeta,
		prompt_file: paths.promptPath,
		wordlist_file: paths.wordlistPath,
		prompt_chars: promptTemplate.length,
		wordlist_chars: wordlistText.length,
	});
	options.logger.info("codex_auth_resolved", { ...requestMeta, mode: authMode });
	options.logger.info("codex_config_written", {
		...requestMeta,
		config_file: paths.codexConfigPath,
		reasoning_effort: options.config.reasoningEffort,
	});
	options.logger.info("codex_prompt_composed", {
		...requestMeta,
		prompt_chars: composedPrompt.length,
		has_known_domain_terms_placeholder: promptTemplate.includes("{{KNOWN_DOMAIN_TERMS}}"),
		has_transcript_placeholder: promptTemplate.includes("{{TRANSCRIPT}}"),
	});

	return {
		paths,
		requestMeta,
		tempDir,
		promptFilePath,
		jsonOutputPath,
		startedAt: Date.now(),
		pipelineStartedAt,
	};
}

function logExecutionStart(context: ExecutionContext): void {
	context.options.logger.info("codex_exec_started", {
		...context.prepared.requestMeta,
		model: context.options.config.model,
		codex_home: context.prepared.paths.codexHomePath,
		prep_latency_ms: context.prepared.startedAt - context.prepared.pipelineStartedAt,
	});
}

async function runCodexWithLogging(
	context: ExecutionContext,
	execCodex: (input: CodexExecInput) => Promise<CodexExecOutput>,
): Promise<CodexExecOutput> {
	return withSoftTimeout(
		(abortSignal) =>
			execCodex({
				codexBin: context.options.config.codexBin,
				cwd: context.prepared.paths.projectRoot,
				env: buildChildEnv(context.prepared.paths.codexUserHomePath,
					context.prepared.paths.codexHomePath),
				model: context.options.config.model,
				schemaPath: context.prepared.paths.schemaPath,
				promptPath: context.prepared.promptFilePath,
				jsonOutputPath: context.prepared.jsonOutputPath,
				abortSignal,
			}),
		context.options.config.timeoutMs,
		() => {
			context.options.logger.info("codex_exec_timeout_abort_requested", {
				...context.prepared.requestMeta,
				timeout_ms: context.options.config.timeoutMs,
				model: context.options.config.model,
			});
		},
	);
}

async function collectDiagnosticsSafe(
	codexHomePath: string,
	startedAt: number,
	endedAt: number,
): Promise<Record<string, unknown>> {
	try {
		return await collectSessionDiagnostics(codexHomePath, startedAt, endedAt);
	} catch (error) {
		return {
			session_found: false,
			session_diagnostics_error: error instanceof Error ? error.message : String(error),
		};
	}
}

function logSessionDiagnostics(
	context: ExecutionContext,
	status: "completed" | "failed",
	diagnostics: Record<string, unknown>,
): void {
	context.options.logger.info("codex_exec_session_diagnostics", {
		...context.prepared.requestMeta,
		...diagnostics,
		status,
	});
}

function logExecutionCompleted(args: {
	context: ExecutionContext;
	result: CodexExecOutput;
	cleanedTranscript: string;
	diagnostics: Record<string, unknown>;
	endedAt: number;
}): void {
	logSessionDiagnostics(args.context, "completed", args.diagnostics);
	args.context.options.logger.info("codex_exec_completed", {
		...args.context.prepared.requestMeta,
		latency_ms: args.endedAt - args.context.prepared.startedAt,
		output_chars: args.cleanedTranscript.length,
		...(isBlank(args.result.stderr) ? {} : { stderr_preview: textPreview(args.result.stderr) }),
		...(isBlank(args.result.stdout) ? {} : { stdout_preview: textPreview(args.result.stdout) }),
	});
}

function logExecutionFailed(args: {
	context: ExecutionContext;
	error: unknown;
	lastResult: CodexExecOutput | null;
	diagnostics: Record<string, unknown>;
	endedAt: number;
}): void {
	logSessionDiagnostics(args.context, "failed", args.diagnostics);
	args.context.options.logger.error("codex_exec_failed", {
		...args.context.prepared.requestMeta,
		latency_ms: args.endedAt - args.context.prepared.startedAt,
		error: args.error instanceof Error ? args.error.message : String(args.error),
		...(args.error instanceof CodexRuntimeError ? { error_code: args.error.code } : {}),
		...(args.lastResult && !isBlank(args.lastResult.stderr)
			? { stderr_preview: textPreview(args.lastResult.stderr) }
			: {}),
		...(args.lastResult && !isBlank(args.lastResult.stdout)
			? { stdout_preview: textPreview(args.lastResult.stdout) }
			: {}),
	});
}

async function executePreparedRun(
	options: ProcessOptions,
	prepared: PreparedRun,
	execCodex: (input: CodexExecInput) => Promise<CodexExecOutput>,
): Promise<string> {
	const context: ExecutionContext = { options, prepared };
	logExecutionStart(context);
	let lastResult: CodexExecOutput | null = null;

	try {
		const result = await runCodexWithLogging(context, execCodex);
		lastResult = result;
		if (result.exitCode !== 0) {
			throw new CodexRuntimeError(
				"codex_exit_non_zero",
				`Codex command failed with exit code ${result.exitCode}. ${textPreview(result.stderr)}`,
			);
		}

		const cleanedTranscript = await loadCleanedTranscript(prepared.jsonOutputPath);
		const endedAt = Date.now();
		const diagnostics = await collectSessionDiagnostics(prepared.paths.codexHomePath,
			prepared.startedAt, endedAt);
		logExecutionCompleted({ context, result, cleanedTranscript, diagnostics, endedAt });
		return cleanedTranscript;
	} catch (error) {
		const endedAt = Date.now();
		const diagnostics = await collectDiagnosticsSafe(prepared.paths.codexHomePath,
			prepared.startedAt, endedAt);
		logExecutionFailed({ context, error, lastResult, diagnostics, endedAt });
		throw error;
	} finally {
		await rm(prepared.tempDir, { recursive: true, force: true });
	}
}

export class CodexRuntimeError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "CodexRuntimeError";
		this.code = code;
	}
}

export async function processWithCodex(options: ProcessOptions): Promise<string> {
	const pipelineStartedAt = Date.now();
	const requestMeta = buildRequestMeta(options.requestId);
	const prepared = await prepareRun(options, requestMeta, pipelineStartedAt);
	if (!prepared) {
		return options.transcript;
	}

	const execCodex = options.execCodex ?? runCodexCommand;
	return executePreparedRun(options, prepared, execCodex);
}
