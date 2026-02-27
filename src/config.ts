import { loadTransparkerFileDefaults } from "./fileConfig";
import { parseBooleanish, parseInteger } from "./parsing";

export interface AppConfig {
	readonly port: number;
	readonly host: string;
	readonly logLevel: string;
	readonly logFullTranscripts: boolean;
	readonly modelId: string;
	readonly modelOwner: string;
}

function parsePort(raw: string | undefined, fallback: number): number {
	const parsed = parseInteger(raw);
	if (parsed === undefined) {
		return fallback;
	}
	if (parsed < 1 || parsed > 65535) {
		throw new Error(`Invalid PORT value: "${raw}"`);
	}
	return parsed;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
	const parsed = parseBooleanish(raw);
	return parsed === undefined ? fallback : parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
	const fileDefaults = loadTransparkerFileDefaults(env);

	return {
		port: parsePort(env.PORT, fileDefaults.app.port),
		host: env.HOST ?? fileDefaults.app.host,
		logLevel: env.LOG_LEVEL ?? fileDefaults.app.logLevel,
		logFullTranscripts: parseBoolean(
			env.TRANSPARKER_LOG_FULL_TRANSCRIPTS,
			fileDefaults.app.logFullTranscripts,
		),
		modelId: env.TRANSPARKER_MODEL_ID ?? fileDefaults.app.modelId,
		modelOwner: env.TRANSPARKER_MODEL_OWNER ?? fileDefaults.app.modelOwner,
	};
}
