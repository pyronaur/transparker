import type { CodexExecInput } from "./codexRuntime";

export interface CodexExecOutput {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
}

export async function runCodexCommand(input: CodexExecInput): Promise<CodexExecOutput> {
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
			"-",
		],
		cwd: input.cwd,
		env: input.env,
		stdin: Bun.file(input.promptPath),
		stdout: "pipe",
		stderr: "pipe",
		signal: input.abortSignal,
	});

	const [exitCode, stdout, stderr] = await Promise.all([
		subprocess.exited,
		new Response(subprocess.stdout).text(),
		new Response(subprocess.stderr).text(),
	]);

	return {
		exitCode,
		stdout,
		stderr,
	};
}
