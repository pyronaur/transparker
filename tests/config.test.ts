import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  test("defaults full transcript logging to disabled", () => {
    const config = loadConfig({
      PORT: "43113"
    } as unknown as NodeJS.ProcessEnv);

    expect(config.logFullTranscripts).toBe(false);
  });

  test("parses full transcript logging env flag", () => {
    const config = loadConfig({
      PORT: "43113",
      TRANSPARKER_LOG_FULL_TRANSCRIPTS: "true"
    } as unknown as NodeJS.ProcessEnv);

    expect(config.logFullTranscripts).toBe(true);
  });
});
