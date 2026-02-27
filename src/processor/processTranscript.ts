import { Logger } from "../logging/logger";
import { loadCodexRuntimeConfig, processWithCodex } from "./codexRuntime";

const codexConfig = loadCodexRuntimeConfig();
const logger = new Logger(process.env.LOG_LEVEL ?? "info");

interface ProcessTranscriptContext {
	readonly requestId?: string;
}

export async function processTranscript(
	text: string,
	context: ProcessTranscriptContext = {},
): Promise<string> {
	return processWithCodex({
		transcript: text,
		config: codexConfig,
		logger,
		requestId: context.requestId,
	});
}
