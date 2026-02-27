import { createApp } from "./app";
import { loadConfig } from "./config";
import { Logger } from "./logging/logger";
import { processTranscript } from "./processor/processTranscript";

const config = loadConfig();
const logger = new Logger(config.logLevel);
const app = createApp(config, logger, { processTranscript });

const server = Bun.serve({
	hostname: config.host,
	port: config.port,
	fetch: app.fetch,
});

logger.info("server_started", {
	host: config.host,
	port: config.port,
	model: config.modelId,
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		logger.info("server_stopping", { signal });
		void server.stop(true);
		process.exit(0);
	});
}
