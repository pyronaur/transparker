import { describe, expect, test } from "bun:test";
import {
  chmod,
  cp,
  mkdtemp,
  mkdir,
  rm,
  writeFile
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const transparkerScript = resolve(import.meta.dir, "../npm/bin/transparker");

async function makeTempPackage(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "transparker-launcher-test-"));
  await mkdir(join(root, "npm/bin"), { recursive: true });
  await mkdir(join(root, "dist/bin"), { recursive: true });
  await mkdir(join(root, "scripts"), { recursive: true });
  await cp(transparkerScript, join(root, "npm/bin/transparker"));
  await chmod(join(root, "npm/bin/transparker"), 0o755);
  return root;
}

async function writeExecutable(path: string, content: string): Promise<void> {
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
}

async function makeMockUname(path: string): Promise<void> {
  const script = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "case \"${1:-}\" in",
    "  -s)",
    "    echo \"${MOCK_UNAME_S:-Linux}\"",
    "    ;;",
    "  -m)",
    "    echo \"${MOCK_UNAME_M:-x86_64}\"",
    "    ;;",
    "  *)",
    "    echo \"unsupported uname args: $*\" >&2",
    "    exit 1",
    "    ;;",
    "esac"
  ].join("\n");
  await writeExecutable(path, script);
}

async function makeMockLdd(path: string, value: string): Promise<void> {
  await writeExecutable(path, `#!/usr/bin/env bash\necho "${value}"\n`);
}

describe("npm/bin/transparker launcher", () => {
  test("uses linux x64 binary when platform is Linux x86_64", async () => {
    const root = await makeTempPackage();
    try {
      await writeExecutable(
        join(root, "dist/bin/transparker-linux-x64"),
        "#!/usr/bin/env bash\necho linux-x64-selected\n"
      );

      const mockBinDir = join(root, "mock-bin");
      await mkdir(mockBinDir, { recursive: true });
      await makeMockUname(join(mockBinDir, "uname"));

      const child = Bun.spawn(["bash", join(root, "npm/bin/transparker"), "serve"], {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${mockBinDir}:${process.env.PATH}`,
          MOCK_UNAME_S: "Linux",
          MOCK_UNAME_M: "x86_64"
        },
        stdout: "pipe",
        stderr: "pipe"
      });

      const [stdout, stderr] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text()
      ]);
      const exitCode = await child.exited;

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("linux-x64-selected");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("falls back to linux x64 musl binary when glibc binary is missing", async () => {
    const root = await makeTempPackage();
    try {
      await writeExecutable(
        join(root, "dist/bin/transparker-linux-x64-musl"),
        "#!/usr/bin/env bash\necho linux-x64-musl-selected\n"
      );

      const mockBinDir = join(root, "mock-bin");
      await mkdir(mockBinDir, { recursive: true });
      await makeMockUname(join(mockBinDir, "uname"));

      const child = Bun.spawn(["bash", join(root, "npm/bin/transparker"), "serve"], {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${mockBinDir}:${process.env.PATH}`,
          MOCK_UNAME_S: "Linux",
          MOCK_UNAME_M: "x86_64"
        },
        stdout: "pipe",
        stderr: "pipe"
      });

      const [stdout, stderr] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text()
      ]);
      const exitCode = await child.exited;

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("linux-x64-musl-selected");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("prefers linux x64 musl binary on musl systems when both binaries exist", async () => {
    const root = await makeTempPackage();
    try {
      await writeExecutable(
        join(root, "dist/bin/transparker-linux-x64"),
        "#!/usr/bin/env bash\necho linux-x64-selected\n"
      );
      await writeExecutable(
        join(root, "dist/bin/transparker-linux-x64-musl"),
        "#!/usr/bin/env bash\necho linux-x64-musl-selected\n"
      );

      const mockBinDir = join(root, "mock-bin");
      await mkdir(mockBinDir, { recursive: true });
      await makeMockUname(join(mockBinDir, "uname"));
      await makeMockLdd(join(mockBinDir, "ldd"), "musl libc (x86_64)");

      const child = Bun.spawn(["bash", join(root, "npm/bin/transparker"), "serve"], {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${mockBinDir}:${process.env.PATH}`,
          MOCK_UNAME_S: "Linux",
          MOCK_UNAME_M: "x86_64"
        },
        stdout: "pipe",
        stderr: "pipe"
      });

      const [stdout, stderr] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text()
      ]);
      const exitCode = await child.exited;

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("linux-x64-musl-selected");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("routes install-service to linux systemd user script on Linux", async () => {
    const root = await makeTempPackage();
    try {
      await writeExecutable(
        join(root, "scripts/install-systemd-user-service.sh"),
        "#!/usr/bin/env bash\necho linux-install-service\n"
      );

      const mockBinDir = join(root, "mock-bin");
      await mkdir(mockBinDir, { recursive: true });
      await makeMockUname(join(mockBinDir, "uname"));

      const child = Bun.spawn(["bash", join(root, "npm/bin/transparker"), "install-service"], {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${mockBinDir}:${process.env.PATH}`,
          MOCK_UNAME_S: "Linux",
          MOCK_UNAME_M: "x86_64"
        },
        stdout: "pipe",
        stderr: "pipe"
      });

      const [stdout, stderr] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text()
      ]);
      const exitCode = await child.exited;

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("linux-install-service");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
