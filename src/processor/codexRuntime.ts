import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";

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
  const projectRoot = resolve(env.TRANSPARKER_PROJECT_ROOT ?? process.cwd());
  const defaultGlobalAuthFile = join(homedir(), "codex/auth.json");

  return {
    projectRoot,
    codexBin: env.TRANSPARKER_CODEX_BIN ?? "codex",
    model: env.TRANSPARKER_CODEX_MODEL ?? "gpt-5.3-codex-spark",
    reasoningEffort: parseReasoningEffort(env.TRANSPARKER_CODEX_REASONING_EFFORT),
    timeoutMs: parsePositiveInt(env.TRANSPARKER_CODEX_TIMEOUT_MS, 120_000),
    codexHomeDir: env.TRANSPARKER_CODEX_HOME_DIR ?? "./codex",
    codexUserHomeDir: env.TRANSPARKER_CODEX_USER_HOME_DIR ?? "./codex/.home",
    globalAuthFile: env.TRANSPARKER_GLOBAL_AUTH_FILE ?? defaultGlobalAuthFile,
    wordlistFile: env.TRANSPARKER_WORDLIST_FILE ?? "./WORDLIST.md",
    codexConfigFile: env.TRANSPARKER_CODEX_CONFIG_FILE ?? "./codex/config.toml",
    promptFile: env.TRANSPARKER_PROMPT_FILE ?? "./PROMPT.md",
    outputSchemaFile: env.TRANSPARKER_CODEX_OUTPUT_SCHEMA_FILE ?? "./codex/output.schema.json"
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

function stderrPreview(stderr: string): string {
  return stderr.replace(/\s+/g, " ").trim().slice(0, 280);
}

interface ProcessOptions {
  readonly transcript: string;
  readonly config: CodexRuntimeConfig;
  readonly logger: CodexRuntimeLogger;
  readonly execCodex?: (input: CodexExecInput) => Promise<CodexExecOutput>;
}

export async function processWithCodex(options: ProcessOptions): Promise<string> {
  const execCodex = options.execCodex ?? runCodexCommand;

  const projectRoot = options.config.projectRoot;
  const rootPromptPath = resolvePath(projectRoot, options.config.promptFile);
  const rootWordlistPath = resolvePath(projectRoot, options.config.wordlistFile);
  const codexHomePath = resolvePath(projectRoot, options.config.codexHomeDir);
  const codexUserHomePath = resolvePath(projectRoot, options.config.codexUserHomeDir);
  const codexAgentsPath = resolve(codexHomePath, "AGENTS.md");
  const codexConfigPath = resolvePath(projectRoot, options.config.codexConfigFile);
  const schemaPath = resolvePath(projectRoot, options.config.outputSchemaFile);

  await mkdir(codexHomePath, { recursive: true });

  const [agentsText, promptTemplate] = await Promise.all([
    readFile(codexAgentsPath, "utf8"),
    readFile(rootPromptPath, "utf8")
  ]);

  if (isBlank(agentsText) || isBlank(promptTemplate)) {
    options.logger.info("codex_passthrough_empty_prompt_files", {
      agents_file: codexAgentsPath,
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
    agents_file: codexAgentsPath,
    prompt_file: rootPromptPath,
    wordlist_file: rootWordlistPath,
    agents_chars: agentsText.length,
    prompt_chars: promptTemplate.length,
    wordlist_chars: wordlistText.length
  });

  options.logger.info("codex_auth_resolved", {
    mode: authMode
  });

  options.logger.info("codex_config_written", {
    config_file: codexConfigPath,
    reasoning_effort: options.config.reasoningEffort
  });

  const composedPrompt = buildPrompt(promptTemplate, options.transcript, wordlistText);
  const tempDir = await mkdtemp(join(tmpdir(), "transparker-codex-"));
  const promptPath = resolve(tempDir, "prompt.txt");
  const jsonOutputPath = resolve(tempDir, "output.json");
  await writeFile(promptPath, composedPrompt, "utf8");

  options.logger.info("codex_prompt_composed", {
    prompt_chars: composedPrompt.length,
    has_known_domain_terms_placeholder: promptTemplate.includes("{{KNOWN_DOMAIN_TERMS}}"),
    has_transcript_placeholder: promptTemplate.includes("{{TRANSCRIPT}}")
  });

  const startedAt = Date.now();

  options.logger.info("codex_exec_started", {
    model: options.config.model,
    codex_home: codexHomePath
  });

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
          timeout_ms: options.config.timeoutMs,
          model: options.config.model
        });
      }
    );

    if (result.exitCode !== 0) {
      throw new CodexRuntimeError(
        "codex_exit_non_zero",
        `Codex command failed with exit code ${result.exitCode}. ${stderrPreview(result.stderr)}`
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

    options.logger.info("codex_exec_completed", {
      latency_ms: Date.now() - startedAt,
      output_chars: cleanedTranscript.length
    });

    return cleanedTranscript;
  } catch (error) {
    options.logger.error("codex_exec_failed", {
      latency_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
