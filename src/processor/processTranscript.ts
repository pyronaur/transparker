import { Logger } from "../logging/logger";
import { loadCodexRuntimeConfig, processWithCodex } from "./codexRuntime";

const codexConfig = loadCodexRuntimeConfig();
const logger = new Logger(process.env.LOG_LEVEL ?? "info");

export async function processTranscript(text: string): Promise<string> {
  return processWithCodex({
    transcript: text,
    config: codexConfig,
    logger
  });
}
