import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { loadTransparkerFileDefaults } from "../fileConfig";

const DEFAULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["cleaned_transcript"],
  properties: {
    cleaned_transcript: {
      type: "string"
    }
  }
} as const;

export interface CodexRuntimeConfig {
  readonly projectRoot: string;
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

interface CodexExecOutput {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CodexRuntimeLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export class CodexRuntimeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CodexRuntimeError";
    this.code = code;
  }
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parseReasoningEffort(
  raw: string | undefined
): "low" | "medium" | "high" {
  if (raw === "low" || raw === "medium" || raw === "high") {
    return raw;
  }
  return "low";
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

function splitLines(value: string): string[] {
  return value.replace(/\r\n/g, "\n").split("\n");
}

export function buildPrompt(
  template: string,
  transcript: string,
  knownTerms: string
): string {
  const out: string[] = [];
  const knownTermLines = splitLines(knownTerms);
  const transcriptLines = splitLines(transcript);

  for (const line of splitLines(template)) {
    if (line === "{{KNOWN_DOMAIN_TERMS}}") {
      out.push(...knownTermLines);
      continue;
    }
    if (line === "{{TRANSCRIPT}}") {
      out.push(...transcriptLines);
      continue;
    }
    out.push(line);
  }

  return out.join("\n");
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

async function writeCodexConfig(path: string, reasoningEffort: "low" | "medium" | "high"): Promise<void> {
  const lines = [
    'web_search = "disabled"',
    'personality = "none"',
    `model_reasoning_effort = "${reasoningEffort}"`
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
  codexHomePath: string
): Promise<"local_file" | "linked_global_file"> {
  const localAuthPath = resolve(codexHomePath, "auth.json");
  const globalAuthPath = resolvePath(config.projectRoot, config.globalAuthFile);

  if (!(await exists(localAuthPath)) && (await exists(globalAuthPath))) {
    try {
      await symlink(globalAuthPath, localAuthPath);
      return "linked_global_file";
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST" &&
        (await exists(localAuthPath))
      ) {
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
    `Missing auth: provide ${globalAuthPath} or ./codex/auth.json.`
  );
}

export function loadCodexRuntimeConfig(env: NodeJS.ProcessEnv = process.env): CodexRuntimeConfig {
  const fileDefaults = loadTransparkerFileDefaults(env);
  const projectRoot = resolve(env.TRANSPARKER_PROJECT_ROOT ?? process.cwd());

  return {
    projectRoot,
    codexBin: env.TRANSPARKER_CODEX_BIN ?? fileDefaults.codex.codexBin,
    model: env.TRANSPARKER_CODEX_MODEL ?? fileDefaults.codex.model,
    reasoningEffort: parseReasoningEffort(
      env.TRANSPARKER_CODEX_REASONING_EFFORT ?? fileDefaults.codex.reasoningEffort
    ),
    timeoutMs: parsePositiveInt(env.TRANSPARKER_CODEX_TIMEOUT_MS, fileDefaults.codex.timeoutMs),
    codexHomeDir: env.TRANSPARKER_CODEX_HOME_DIR ?? fileDefaults.codex.codexHomeDir,
    codexUserHomeDir: env.TRANSPARKER_CODEX_USER_HOME_DIR ?? fileDefaults.codex.codexUserHomeDir,
    globalAuthFile: env.TRANSPARKER_GLOBAL_AUTH_FILE ?? fileDefaults.codex.globalAuthFile,
    wordlistFile: env.TRANSPARKER_WORDLIST_FILE ?? fileDefaults.codex.wordlistFile,
    codexConfigFile: env.TRANSPARKER_CODEX_CONFIG_FILE ?? fileDefaults.codex.codexConfigFile,
    promptFile: env.TRANSPARKER_PROMPT_FILE ?? fileDefaults.codex.promptFile,
    outputSchemaFile: env.TRANSPARKER_CODEX_OUTPUT_SCHEMA_FILE ?? fileDefaults.codex.outputSchemaFile
  };
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

async function runCodexCommand(input: CodexExecInput): Promise<CodexExecOutput> {
  const subprocess = Bun.spawn({
    cmd: [
      input.codexBin,
      "--ask-for-approval",
      "never",
      "-C",
      input.cwd,
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--model",
      input.model,
      "--output-schema",
      input.schemaPath,
      "--output-last-message",
      input.jsonOutputPath,
      "-"
    ],
    cwd: input.cwd,
    env: input.env,
    stdin: Bun.file(input.promptPath),
    stdout: "pipe",
    stderr: "pipe",
    signal: input.abortSignal
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text()
  ]);

  return {
    exitCode,
    stdout,
    stderr
  };
}

async function withSoftTimeout<T>(
  work: (abortSignal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void
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

interface SessionSnapshot {
  readonly file: string;
  readonly payloadStartedAt: number;
  readonly firstEventAt: number;
  readonly sessionId: string;
  readonly eventCount: number;
  readonly hasTaskComplete: boolean;
  readonly taskCompletedAt: number | null;
}

function toIsoDatePath(timestampMs: number): string {
  const date = new Date(timestampMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

async function listSessionFiles(
  codexHomePath: string,
  startedAtMs: number,
  endedAtMs: number
): Promise<string[]> {
  const sessionsRoot = resolve(codexHomePath, "sessions");
  const dayMs = 24 * 60 * 60 * 1000;
  const dayPaths = unique([
    toIsoDatePath(startedAtMs - dayMs),
    toIsoDatePath(startedAtMs),
    toIsoDatePath(startedAtMs + dayMs),
    toIsoDatePath(endedAtMs)
  ]);

  const files: string[] = [];
  for (const dayPath of dayPaths) {
    const dayDir = resolve(sessionsRoot, dayPath);
    if (!(await exists(dayDir))) {
      continue;
    }

    const entries = await readdir(dayDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
        continue;
      }
      files.push(resolve(dayDir, entry.name));
    }
  }

  return files;
}

async function loadSessionSnapshot(filePath: string): Promise<SessionSnapshot | null> {
  const text = await readFile(filePath, "utf8");
  if (isBlank(text)) {
    return null;
  }

  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return null;
  }

  let firstEvent: unknown;
  try {
    firstEvent = JSON.parse(lines[0]);
  } catch {
    return null;
  }

  if (typeof firstEvent !== "object" || firstEvent === null) {
    return null;
  }

  const firstEventTsRaw = (firstEvent as { timestamp?: unknown }).timestamp;
  const firstEventType = (firstEvent as { type?: unknown }).type;
  const payload = (firstEvent as { payload?: unknown }).payload;

  if (firstEventType !== "session_meta" || typeof payload !== "object" || payload === null) {
    return null;
  }

  const payloadStartRaw = (payload as { timestamp?: unknown }).timestamp;
  const payloadSessionIdRaw = (payload as { id?: unknown }).id;
  if (typeof firstEventTsRaw !== "string" || typeof payloadStartRaw !== "string") {
    return null;
  }

  const firstEventAt = Date.parse(firstEventTsRaw);
  const payloadStartedAt = Date.parse(payloadStartRaw);
  if (!Number.isFinite(firstEventAt) || !Number.isFinite(payloadStartedAt)) {
    return null;
  }

  let hasTaskComplete = false;
  let taskCompletedAt: number | null = null;
  for (const line of lines) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof event !== "object" || event === null) {
      continue;
    }

    const eventType = (event as { type?: unknown }).type;
    const eventTsRaw = (event as { timestamp?: unknown }).timestamp;
    const eventPayload = (event as { payload?: unknown }).payload;
    if (
      eventType === "event_msg" &&
      typeof eventPayload === "object" &&
      eventPayload !== null &&
      (eventPayload as { type?: unknown }).type === "task_complete" &&
      typeof eventTsRaw === "string"
    ) {
      const parsed = Date.parse(eventTsRaw);
      if (Number.isFinite(parsed)) {
        hasTaskComplete = true;
        taskCompletedAt = parsed;
      }
    }
  }

  return {
    file: basename(filePath),
    payloadStartedAt,
    firstEventAt,
    sessionId: typeof payloadSessionIdRaw === "string" ? payloadSessionIdRaw : "unknown",
    eventCount: lines.length,
    hasTaskComplete,
    taskCompletedAt
  };
}

async function collectSessionDiagnostics(
  codexHomePath: string,
  startedAtMs: number,
  endedAtMs: number
): Promise<Record<string, unknown>> {
  const sessionFiles = await listSessionFiles(codexHomePath, startedAtMs, endedAtMs);
  if (sessionFiles.length === 0) {
    return { session_found: false };
  }

  const snapshots = (
    await Promise.all(sessionFiles.map(async (filePath) => loadSessionSnapshot(filePath)))
  ).filter((snapshot): snapshot is SessionSnapshot => snapshot !== null);

  if (snapshots.length === 0) {
    return { session_found: false };
  }

  const windowStartMs = startedAtMs - 5_000;
  const windowEndMs = endedAtMs + 5_000;
  const candidates = snapshots.filter(
    (snapshot) => snapshot.payloadStartedAt >= windowStartMs && snapshot.payloadStartedAt <= windowEndMs
  );

  if (candidates.length === 0) {
    return { session_found: false };
  }

  const closest = candidates.reduce((best, current) => {
    const bestDelta = Math.abs(best.payloadStartedAt - startedAtMs);
    const currentDelta = Math.abs(current.payloadStartedAt - startedAtMs);
    return currentDelta < bestDelta ? current : best;
  });

  return {
    session_found: true,
    session_id: closest.sessionId,
    session_file: closest.file,
    session_boot_gap_ms: Math.max(0, closest.firstEventAt - closest.payloadStartedAt),
    session_active_ms:
      closest.taskCompletedAt === null ? null : Math.max(0, closest.taskCompletedAt - closest.firstEventAt),
    session_has_task_complete: closest.hasTaskComplete,
    session_event_count: closest.eventCount
  };
}

interface ProcessOptions {
  readonly transcript: string;
  readonly config: CodexRuntimeConfig;
  readonly logger: CodexRuntimeLogger;
  readonly requestId?: string;
  readonly execCodex?: (input: CodexExecInput) => Promise<CodexExecOutput>;
}

export async function processWithCodex(options: ProcessOptions): Promise<string> {
  const pipelineStartedAt = Date.now();
  const execCodex = options.execCodex ?? runCodexCommand;
  const requestMeta = options.requestId ? { request_id: options.requestId } : {};

  const projectRoot = options.config.projectRoot;
  const rootPromptPath = resolvePath(projectRoot, options.config.promptFile);
  const rootWordlistPath = resolvePath(projectRoot, options.config.wordlistFile);
  const codexHomePath = resolvePath(projectRoot, options.config.codexHomeDir);
  const codexUserHomePath = resolvePath(projectRoot, options.config.codexUserHomeDir);
  const codexConfigPath = resolvePath(projectRoot, options.config.codexConfigFile);
  const schemaPath = resolvePath(projectRoot, options.config.outputSchemaFile);

  await mkdir(codexHomePath, { recursive: true });

  const promptTemplate = await readFile(rootPromptPath, "utf8");

  if (isBlank(promptTemplate)) {
    options.logger.info("codex_passthrough_blank_prompt", {
      ...requestMeta,
      prompt_file: rootPromptPath
    });
    return options.transcript;
  }

  await Promise.all([
    mkdir(codexUserHomePath, { recursive: true }),
    ensureSchema(schemaPath)
  ]);

  let wordlistText: string;
  try {
    wordlistText = await readFile(rootWordlistPath, "utf8");
  } catch {
    throw new CodexRuntimeError(
      "codex_wordlist_missing",
      `Missing or unreadable word list file: ${rootWordlistPath}.`
    );
  }

  const authMode = await ensureAuth(options.config, codexHomePath);

  await writeCodexConfig(codexConfigPath, options.config.reasoningEffort);

  options.logger.info("codex_assets_loaded", {
    ...requestMeta,
    prompt_file: rootPromptPath,
    wordlist_file: rootWordlistPath,
    prompt_chars: promptTemplate.length,
    wordlist_chars: wordlistText.length
  });

  options.logger.info("codex_auth_resolved", {
    ...requestMeta,
    mode: authMode
  });

  options.logger.info("codex_config_written", {
    ...requestMeta,
    config_file: codexConfigPath,
    reasoning_effort: options.config.reasoningEffort
  });

  const composedPrompt = buildPrompt(promptTemplate, options.transcript, wordlistText);
  const tempDir = await mkdtemp(join(tmpdir(), "transparker-codex-"));
  const promptPath = resolve(tempDir, "prompt.txt");
  const jsonOutputPath = resolve(tempDir, "output.json");
  await writeFile(promptPath, composedPrompt, "utf8");

  options.logger.info("codex_prompt_composed", {
    ...requestMeta,
    prompt_chars: composedPrompt.length,
    has_known_domain_terms_placeholder: promptTemplate.includes("{{KNOWN_DOMAIN_TERMS}}"),
    has_transcript_placeholder: promptTemplate.includes("{{TRANSCRIPT}}")
  });

  const startedAt = Date.now();

  options.logger.info("codex_exec_started", {
    ...requestMeta,
    model: options.config.model,
    codex_home: codexHomePath,
    prep_latency_ms: startedAt - pipelineStartedAt
  });

  let lastResult: CodexExecOutput | null = null;

  try {
    const childEnv: Record<string, string | undefined> = { ...process.env };
    delete childEnv.OPENAI_API_KEY;
    childEnv.HOME = codexUserHomePath;
    childEnv.CODEX_HOME = codexHomePath;

    const result = await withSoftTimeout(
      (abortSignal) =>
        execCodex({
          codexBin: options.config.codexBin,
          cwd: projectRoot,
          env: childEnv,
          model: options.config.model,
          schemaPath,
          promptPath,
          jsonOutputPath,
          abortSignal
        }),
      options.config.timeoutMs,
      () => {
        options.logger.info("codex_exec_timeout_abort_requested", {
          ...requestMeta,
          timeout_ms: options.config.timeoutMs,
          model: options.config.model
        });
      }
    );
    lastResult = result;

    if (result.exitCode !== 0) {
      throw new CodexRuntimeError(
        "codex_exit_non_zero",
        `Codex command failed with exit code ${result.exitCode}. ${textPreview(result.stderr)}`
      );
    }

    const rawOutput = await readFile(jsonOutputPath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawOutput);
    } catch {
      throw new CodexRuntimeError("codex_invalid_json", "Codex output was not valid JSON.");
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { cleaned_transcript?: unknown }).cleaned_transcript !== "string"
    ) {
      throw new CodexRuntimeError(
        "codex_invalid_shape",
        "Codex output JSON must contain a string cleaned_transcript field."
      );
    }

    const cleanedTranscript = (parsed as { cleaned_transcript: string }).cleaned_transcript;
    const endedAt = Date.now();
    const sessionDiagnostics = await collectSessionDiagnostics(codexHomePath, startedAt, endedAt);

    options.logger.info("codex_exec_session_diagnostics", {
      ...requestMeta,
      ...sessionDiagnostics,
      status: "completed"
    });

    options.logger.info("codex_exec_completed", {
      ...requestMeta,
      latency_ms: endedAt - startedAt,
      output_chars: cleanedTranscript.length,
      ...(isBlank(result.stderr) ? {} : { stderr_preview: textPreview(result.stderr) }),
      ...(isBlank(result.stdout) ? {} : { stdout_preview: textPreview(result.stdout) })
    });

    return cleanedTranscript;
  } catch (error) {
    const endedAt = Date.now();
    let sessionDiagnostics: Record<string, unknown>;
    try {
      sessionDiagnostics = await collectSessionDiagnostics(codexHomePath, startedAt, endedAt);
    } catch (diagnosticsError) {
      sessionDiagnostics = {
        session_found: false,
        session_diagnostics_error:
          diagnosticsError instanceof Error ? diagnosticsError.message : String(diagnosticsError)
      };
    }

    options.logger.info("codex_exec_session_diagnostics", {
      ...requestMeta,
      ...sessionDiagnostics,
      status: "failed"
    });

    options.logger.error("codex_exec_failed", {
      ...requestMeta,
      latency_ms: endedAt - startedAt,
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof CodexRuntimeError ? { error_code: error.code } : {}),
      ...(lastResult && !isBlank(lastResult.stderr)
        ? { stderr_preview: textPreview(lastResult.stderr) }
        : {}),
      ...(lastResult && !isBlank(lastResult.stdout)
        ? { stdout_preview: textPreview(lastResult.stdout) }
        : {})
    });
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
