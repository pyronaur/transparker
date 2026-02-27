import { describe, expect, test } from "bun:test";
import { lstat, mkdtemp, mkdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import {
  CodexRuntimeError,
  buildPrompt,
  loadCodexRuntimeConfig,
  processWithCodex,
  type CodexRuntimeConfig,
  type CodexRuntimeLogger
} from "../src/processor/codexRuntime";

interface LoggedEvent {
  readonly level: "info" | "error";
  readonly message: string;
  readonly meta: Record<string, unknown>;
}

async function makeTempProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), "transparker-test-"));
}

function createConfig(projectRoot: string, timeoutMs = 5000): CodexRuntimeConfig {
  return {
    projectRoot,
    codexBin: "codex",
    model: "gpt-5.3-codex-spark",
    reasoningEffort: "medium",
    timeoutMs,
    codexHomeDir: "./codex",
    codexUserHomeDir: "./codex/.home",
    globalAuthFile: "./global-auth.json",
    wordlistFile: "./WORDLIST.md",
    codexConfigFile: "./codex/config.toml",
    promptFile: "./PROMPT.md",
    outputSchemaFile: "./codex/output.schema.json"
  };
}

async function writeCodexAgents(projectRoot: string, text: string): Promise<void> {
  await mkdir(resolve(projectRoot, "codex"), { recursive: true });
  await writeFile(resolve(projectRoot, "codex/AGENTS.md"), text, "utf8");
}

const noopLogger: CodexRuntimeLogger = {
  info() {},
  error() {}
};

function createCapturingLogger(): { logger: CodexRuntimeLogger; events: LoggedEvent[] } {
  const events: LoggedEvent[] = [];
  return {
    logger: {
      info(message, meta = {}) {
        events.push({ level: "info", message, meta });
      },
      error(message, meta = {}) {
        events.push({ level: "error", message, meta });
      }
    },
    events
  };
}

function datePath(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

async function withEnv<T>(patch: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const before = { ...process.env };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }

  try {
    return await run();
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in before)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, before);
  }
}

describe("buildPrompt", () => {
  test("replaces only exact placeholder lines, matching playground awk behavior", () => {
    const output = buildPrompt(
      [
        "header",
        "{{KNOWN_DOMAIN_TERMS}}",
        "inline {{KNOWN_DOMAIN_TERMS}} should stay inline",
        "{{TRANSCRIPT}}",
        "inline {{TRANSCRIPT}} should stay inline"
      ].join("\n"),
      "line 1\nline 2",
      "- one\n- two"
    );

    expect(output).toContain("header\n- one\n- two");
    expect(output).toContain("line 1\nline 2");
    expect(output).toContain("inline {{KNOWN_DOMAIN_TERMS}} should stay inline");
    expect(output).toContain("inline {{TRANSCRIPT}} should stay inline");
  });
});

describe("loadCodexRuntimeConfig", () => {
  test("uses file-backed defaults in ~/.transparker", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "transparker-home-test-"));
    try {
      const config = loadCodexRuntimeConfig({
        TRANSPARKER_PROJECT_ROOT: "/tmp/transparker-test",
        TRANSPARKER_HOME_DIR: homeDir
      } as unknown as NodeJS.ProcessEnv);

      expect(config.globalAuthFile).toBe(join(homedir(), "codex/auth.json"));
      expect(config.model).toBe("gpt-5.3-codex-spark");
      expect(config.reasoningEffort).toBe("low");
      expect(config.wordlistFile).toBe(join(homeDir, "wordlist.md"));
      expect(config.promptFile).toBe(join(homeDir, "prompt.md"));
      expect(config.codexHomeDir).toBe(join(homeDir, "codex"));

      await expect(readFile(join(homeDir, "config.toml"), "utf8")).resolves.toContain("wordlist_file");
      await expect(readFile(join(homeDir, "wordlist.md"), "utf8")).resolves.toContain("transparker");
      await expect(readFile(join(homeDir, "prompt.md"), "utf8")).resolves.toContain("{{TRANSCRIPT}}");
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  test("allows overriding codex model via env", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "transparker-home-test-"));
    try {
      const config = loadCodexRuntimeConfig({
        TRANSPARKER_PROJECT_ROOT: "/tmp/transparker-test",
        TRANSPARKER_HOME_DIR: homeDir,
        TRANSPARKER_CODEX_MODEL: "gpt-5.3-codex-spark-custom"
      } as unknown as NodeJS.ProcessEnv);

      expect(config.model).toBe("gpt-5.3-codex-spark-custom");
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});

describe("processWithCodex", () => {
  test("does not require AGENTS.md", async () => {
    const projectRoot = await makeTempProject();
    try {
      await writeFile(resolve(projectRoot, "PROMPT.md"), "{{TRANSCRIPT}}", "utf8");
      await writeFile(resolve(projectRoot, "WORDLIST.md"), "- term", "utf8");
      await writeFile(resolve(projectRoot, "global-auth.json"), "{\"token\":\"x\"}", "utf8");

      const output = await processWithCodex({
        transcript: "raw transcript",
        config: createConfig(projectRoot),
        logger: noopLogger,
        execCodex: async (input) => {
          await writeFile(
            input.jsonOutputPath,
            JSON.stringify({ cleaned_transcript: "cleaned" }),
            "utf8"
          );
          return { exitCode: 0, stdout: "", stderr: "" };
        }
      });

      expect(output).toBe("cleaned");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("returns passthrough text when PROMPT is blank", async () => {
    const projectRoot = await makeTempProject();
    try {
      await writeFile(resolve(projectRoot, "PROMPT.md"), "   \n", "utf8");

      let called = false;
      const output = await processWithCodex({
        transcript: "raw transcript",
        config: createConfig(projectRoot),
        logger: noopLogger,
        execCodex: async () => {
          called = true;
          return { exitCode: 0, stdout: "", stderr: "" };
        }
      });

      expect(output).toBe("raw transcript");
      expect(called).toBe(false);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("uses codex result and injects WORDLIST + transcript", async () => {
    const projectRoot = await makeTempProject();
    try {
      const agents = "# rules\n";
      await writeCodexAgents(projectRoot, agents);
      await writeFile(
        resolve(projectRoot, "PROMPT.md"),
        "Terms:\n{{KNOWN_DOMAIN_TERMS}}\nTranscript:\n{{TRANSCRIPT}}\n",
        "utf8"
      );
      await writeFile(resolve(projectRoot, "WORDLIST.md"), "- Claude\n- Firecrawl\n", "utf8");
      await writeFile(resolve(projectRoot, "global-auth.json"), "{\"token\":\"x\"}", "utf8");
      await mkdir(resolve(projectRoot, "codex"), { recursive: true });
      await writeFile(resolve(projectRoot, "codex/output.schema.json"), "{}", "utf8");
      await mkdir(resolve(projectRoot, "codex/skills/a"), { recursive: true });
      await writeFile(resolve(projectRoot, "codex/skills/a/SKILL.md"), "# skill", "utf8");

      const output = await withEnv({ OPENAI_API_KEY: "should-not-be-used" }, async () =>
        processWithCodex({
          transcript: "hello from test",
          config: createConfig(projectRoot),
          logger: noopLogger,
          execCodex: async (input) => {
            const prompt = await readFile(input.promptPath, "utf8");
            expect(prompt).toContain("- Claude");
            expect(prompt).toContain("hello from test");
            expect(input.env.CODEX_HOME).toBe(resolve(projectRoot, "codex"));
            expect(input.env.HOME).toBe(resolve(projectRoot, "codex/.home"));
            expect(input.env.OPENAI_API_KEY).toBeUndefined();

            await writeFile(
              input.jsonOutputPath,
              JSON.stringify({ cleaned_transcript: "cleaned by codex" }),
              "utf8"
            );
            return { exitCode: 0, stdout: "", stderr: "" };
          }
        })
      );

      const configToml = await readFile(resolve(projectRoot, "codex/config.toml"), "utf8");
      expect(configToml).toContain('web_search = "disabled"');
      expect(configToml).toContain('personality = "none"');
      expect(configToml).toContain('model_reasoning_effort = "medium"');
      expect(configToml).toContain("[[skills.config]]");
      expect(output).toBe("cleaned by codex");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("symlinks global auth into CODEX_HOME when local auth missing", async () => {
    const projectRoot = await makeTempProject();
    try {
      await writeCodexAgents(projectRoot, "rules");
      await writeFile(resolve(projectRoot, "PROMPT.md"), "{{TRANSCRIPT}}", "utf8");
      await writeFile(resolve(projectRoot, "WORDLIST.md"), "- term", "utf8");
      await writeFile(resolve(projectRoot, "global-auth.json"), "{\"token\":\"x\"}", "utf8");

      await withEnv({ OPENAI_API_KEY: "ignored" }, async () =>
        processWithCodex({
          transcript: "x",
          config: createConfig(projectRoot),
          logger: noopLogger,
          execCodex: async (input) => {
            await writeFile(
              input.jsonOutputPath,
              JSON.stringify({ cleaned_transcript: "ok" }),
              "utf8"
            );
            return { exitCode: 0, stdout: "", stderr: "" };
          }
        })
      );

      const authPath = resolve(projectRoot, "codex/auth.json");
      const stats = await lstat(authPath);
      expect(stats.isSymbolicLink()).toBe(true);
      const linkTarget = await readlink(authPath);
      expect(linkTarget).toBe(resolve(projectRoot, "global-auth.json"));
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("is safe under concurrent auth link creation", async () => {
    const projectRoot = await makeTempProject();
    try {
      await writeCodexAgents(projectRoot, "rules");
      await writeFile(resolve(projectRoot, "PROMPT.md"), "{{TRANSCRIPT}}", "utf8");
      await writeFile(resolve(projectRoot, "WORDLIST.md"), "- term", "utf8");
      await writeFile(resolve(projectRoot, "global-auth.json"), "{\"token\":\"x\"}", "utf8");

      const requests = Array.from({ length: 40 }, (_, index) =>
        processWithCodex({
          transcript: `x-${index}`,
          config: createConfig(projectRoot),
          logger: noopLogger,
          execCodex: async (input) => {
            await writeFile(
              input.jsonOutputPath,
              JSON.stringify({ cleaned_transcript: `ok-${index}` }),
              "utf8"
            );
            return { exitCode: 0, stdout: "", stderr: "" };
          }
        })
      );

      const outputs = await Promise.all(requests);
      expect(outputs).toHaveLength(40);
      const authPath = resolve(projectRoot, "codex/auth.json");
      const stats = await lstat(authPath);
      expect(stats.isSymbolicLink()).toBe(true);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("aborts codex execution when timeout is reached", async () => {
    const projectRoot = await makeTempProject();
    try {
      await writeCodexAgents(projectRoot, "rules");
      await writeFile(resolve(projectRoot, "PROMPT.md"), "{{TRANSCRIPT}}", "utf8");
      await writeFile(resolve(projectRoot, "WORDLIST.md"), "- term", "utf8");
      await writeFile(resolve(projectRoot, "global-auth.json"), "{\"token\":\"x\"}", "utf8");

      let abortTriggered = false;

      await expect(
        processWithCodex({
          transcript: "x",
          config: createConfig(projectRoot, 20),
          logger: noopLogger,
          execCodex: async (input) =>
            new Promise((_resolve, reject) => {
              const signal = input.abortSignal;
              if (!signal) {
                reject(new Error("missing abort signal"));
                return;
              }

              const onAbort = () => {
                abortTriggered = true;
                reject(new Error("aborted"));
              };

              if (signal.aborted) {
                onAbort();
                return;
              }

              signal.addEventListener("abort", onAbort, { once: true });
            })
        })
      ).rejects.toMatchObject({ code: "codex_timeout" });

      expect(abortTriggered).toBe(true);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("throws clear error when wordlist file is missing", async () => {
    const projectRoot = await makeTempProject();
    try {
      await writeCodexAgents(projectRoot, "rules");
      await writeFile(resolve(projectRoot, "PROMPT.md"), "{{TRANSCRIPT}}", "utf8");
      await writeFile(resolve(projectRoot, "global-auth.json"), "{\"token\":\"x\"}", "utf8");

      await expect(
        withEnv({ OPENAI_API_KEY: "ignored" }, () =>
          processWithCodex({
            transcript: "x",
            config: createConfig(projectRoot),
            logger: noopLogger,
            execCodex: async () => ({ exitCode: 0, stdout: "", stderr: "" })
          })
        )
      ).rejects.toThrow("Missing or unreadable word list file");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("throws clear error when no auth file even if OPENAI_API_KEY is present", async () => {
    const projectRoot = await makeTempProject();
    try {
      await writeCodexAgents(projectRoot, "rules");
      await writeFile(resolve(projectRoot, "PROMPT.md"), "{{TRANSCRIPT}}", "utf8");
      await writeFile(resolve(projectRoot, "WORDLIST.md"), "- term", "utf8");

      await expect(
        withEnv({ OPENAI_API_KEY: "ignored" }, () =>
          processWithCodex({
            transcript: "x",
            config: createConfig(projectRoot),
            logger: noopLogger,
            execCodex: async () => ({ exitCode: 0, stdout: "", stderr: "" })
          })
        )
      ).rejects.toThrow("Missing auth: provide");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("throws when codex exits non-zero", async () => {
    const projectRoot = await makeTempProject();
    try {
      await writeCodexAgents(projectRoot, "rules");
      await writeFile(resolve(projectRoot, "PROMPT.md"), "{{TRANSCRIPT}}", "utf8");
      await writeFile(resolve(projectRoot, "WORDLIST.md"), "- term", "utf8");
      await writeFile(resolve(projectRoot, "global-auth.json"), "{\"token\":\"x\"}", "utf8");

      await expect(
        withEnv({ OPENAI_API_KEY: "ignored" }, () =>
          processWithCodex({
            transcript: "x",
            config: createConfig(projectRoot),
            logger: noopLogger,
            execCodex: async () => ({ exitCode: 2, stdout: "", stderr: "command failed" })
          })
        )
      ).rejects.toThrow("exit code 2");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("throws typed error for invalid codex JSON shape", async () => {
    const projectRoot = await makeTempProject();
    try {
      await writeCodexAgents(projectRoot, "rules");
      await writeFile(resolve(projectRoot, "PROMPT.md"), "{{TRANSCRIPT}}", "utf8");
      await writeFile(resolve(projectRoot, "WORDLIST.md"), "- term", "utf8");
      await writeFile(resolve(projectRoot, "global-auth.json"), "{\"token\":\"x\"}", "utf8");

      await expect(
        withEnv({ OPENAI_API_KEY: "ignored" }, () =>
          processWithCodex({
            transcript: "x",
            config: createConfig(projectRoot),
            logger: noopLogger,
            execCodex: async (input) => {
              await writeFile(input.jsonOutputPath, JSON.stringify({ wrong: "shape" }), "utf8");
              return { exitCode: 0, stdout: "", stderr: "" };
            }
          })
        )
      ).rejects.toBeInstanceOf(CodexRuntimeError);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("logs session diagnostics and request id for codex execution", async () => {
    const projectRoot = await makeTempProject();
    const { logger, events } = createCapturingLogger();

    try {
      await writeFile(resolve(projectRoot, "PROMPT.md"), "{{TRANSCRIPT}}", "utf8");
      await writeFile(resolve(projectRoot, "WORDLIST.md"), "- term", "utf8");
      await writeFile(resolve(projectRoot, "global-auth.json"), "{\"token\":\"x\"}", "utf8");

      await processWithCodex({
        transcript: "x",
        requestId: "req-123",
        config: createConfig(projectRoot),
        logger,
        execCodex: async (input) => {
          const now = new Date();
          const payloadStartIso = new Date(now.getTime()).toISOString();
          const firstEventIso = new Date(now.getTime() + 20_000).toISOString();
          const taskCompleteIso = new Date(now.getTime() + 22_000).toISOString();
          const sessionRoot = resolve(projectRoot, "codex/sessions", datePath(now));
          await mkdir(sessionRoot, { recursive: true });
          await writeFile(
            resolve(sessionRoot, "rollout-test.jsonl"),
            [
              JSON.stringify({
                timestamp: firstEventIso,
                type: "session_meta",
                payload: {
                  id: "session-123",
                  timestamp: payloadStartIso
                }
              }),
              JSON.stringify({
                timestamp: firstEventIso,
                type: "event_msg",
                payload: {
                  type: "task_started"
                }
              }),
              JSON.stringify({
                timestamp: taskCompleteIso,
                type: "event_msg",
                payload: {
                  type: "task_complete"
                }
              })
            ].join("\n"),
            "utf8"
          );
          await writeFile(
            input.jsonOutputPath,
            JSON.stringify({ cleaned_transcript: "cleaned" }),
            "utf8"
          );
          return { exitCode: 0, stdout: "", stderr: "" };
        }
      });

      const diagnostics = events.find((event) => event.message === "codex_exec_session_diagnostics");
      expect(diagnostics).toBeDefined();
      expect(diagnostics?.meta.request_id).toBe("req-123");
      expect(diagnostics?.meta.session_found).toBe(true);
      expect(diagnostics?.meta.session_id).toBe("session-123");
      expect(diagnostics?.meta.session_has_task_complete).toBe(true);
      expect(diagnostics?.meta.session_active_ms).toBe(2000);
      expect((diagnostics?.meta.session_boot_gap_ms as number) >= 20_000).toBe(true);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
