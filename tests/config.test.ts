import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  test("defaults full transcript logging to disabled", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "transparker-config-test-"));
    try {
      const config = loadConfig({
        PORT: "43113",
        TRANSPARKER_HOME_DIR: homeDir
      } as unknown as NodeJS.ProcessEnv);

      expect(config.logFullTranscripts).toBe(false);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  test("parses full transcript logging env flag", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "transparker-config-test-"));
    try {
      const config = loadConfig({
        PORT: "43113",
        TRANSPARKER_HOME_DIR: homeDir,
        TRANSPARKER_LOG_FULL_TRANSCRIPTS: "true"
      } as unknown as NodeJS.ProcessEnv);

      expect(config.logFullTranscripts).toBe(true);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  test("reads app defaults from config.toml", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "transparker-config-test-"));
    try {
      await writeFile(
        join(homeDir, "config.toml"),
        [
          'host = "0.0.0.0"',
          "port = 5000",
          'log_level = "debug"',
          "log_full_transcripts = true",
          'model_id = "CustomModel"',
          'model_owner = "local-owner"',
          `wordlist_file = "${join(homeDir, "wordlist.md")}"`,
          "",
          "[codex]",
          `prompt_file = "${join(homeDir, "prompt.md")}"`
        ].join("\n"),
        "utf8"
      );

      const config = loadConfig({
        TRANSPARKER_HOME_DIR: homeDir
      } as unknown as NodeJS.ProcessEnv);

      expect(config.host).toBe("0.0.0.0");
      expect(config.port).toBe(5000);
      expect(config.logLevel).toBe("debug");
      expect(config.logFullTranscripts).toBe(true);
      expect(config.modelId).toBe("CustomModel");
      expect(config.modelOwner).toBe("local-owner");
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  test("env values override config.toml values", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "transparker-config-test-"));
    try {
      await writeFile(
        join(homeDir, "config.toml"),
        [
          'host = "0.0.0.0"',
          "port = 5000",
          'log_level = "debug"',
          "log_full_transcripts = false",
          'model_id = "CustomModel"',
          'model_owner = "local-owner"',
          `wordlist_file = "${join(homeDir, "wordlist.md")}"`,
          "",
          "[codex]",
          `prompt_file = "${join(homeDir, "prompt.md")}"`
        ].join("\n"),
        "utf8"
      );

      const config = loadConfig({
        TRANSPARKER_HOME_DIR: homeDir,
        HOST: "127.0.0.1",
        PORT: "43113",
        LOG_LEVEL: "info",
        TRANSPARKER_LOG_FULL_TRANSCRIPTS: "true",
        TRANSPARKER_MODEL_ID: "Transparker",
        TRANSPARKER_MODEL_OWNER: "transparker-local"
      } as unknown as NodeJS.ProcessEnv);

      expect(config.host).toBe("127.0.0.1");
      expect(config.port).toBe(43113);
      expect(config.logLevel).toBe("info");
      expect(config.logFullTranscripts).toBe(true);
      expect(config.modelId).toBe("Transparker");
      expect(config.modelOwner).toBe("transparker-local");
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  test("throws for invalid port values in config.toml", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "transparker-config-test-"));
    try {
      for (const invalidPort of [0, -1, 70000]) {
        await writeFile(
          join(homeDir, "config.toml"),
          [
            'host = "127.0.0.1"',
            `port = ${invalidPort}`,
            'log_level = "info"',
            "log_full_transcripts = false",
            'model_id = "Transparker"',
            'model_owner = "transparker-local"',
            `wordlist_file = "${join(homeDir, "wordlist.md")}"`,
            "",
            "[codex]",
            `prompt_file = "${join(homeDir, "prompt.md")}"`
          ].join("\n"),
          "utf8"
        );

        expect(() =>
          loadConfig({
            TRANSPARKER_HOME_DIR: homeDir
          } as unknown as NodeJS.ProcessEnv)
        ).toThrow("Invalid port in Transparker config");
      }
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});
