import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("build-binaries script", () => {
  test("includes linux targets for glibc and musl on x64 and arm64", async () => {
    const scriptPath = resolve(import.meta.dir, "../scripts/build-binaries.sh");
    const script = await readFile(scriptPath, "utf8");

    expect(script).toContain("bun-linux-x64 transparker-linux-x64");
    expect(script).toContain("bun-linux-arm64 transparker-linux-arm64");
    expect(script).toContain("bun-linux-x64-musl transparker-linux-x64-musl");
    expect(script).toContain("bun-linux-arm64-musl transparker-linux-arm64-musl");
  });
});
