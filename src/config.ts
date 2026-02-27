import { loadTransparkerFileDefaults } from "./fileConfig";

export interface AppConfig {
  readonly port: number;
  readonly host: string;
  readonly logLevel: string;
  readonly logFullTranscripts: boolean;
  readonly modelId: string;
  readonly modelOwner: string;
}

function parsePort(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid PORT value: "${raw}"`);
  }

  return parsed;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const fileDefaults = loadTransparkerFileDefaults(env);

  return {
    port: parsePort(env.PORT, fileDefaults.app.port),
    host: env.HOST ?? fileDefaults.app.host,
    logLevel: env.LOG_LEVEL ?? fileDefaults.app.logLevel,
    logFullTranscripts: parseBoolean(
      env.TRANSPARKER_LOG_FULL_TRANSCRIPTS,
      fileDefaults.app.logFullTranscripts
    ),
    modelId: env.TRANSPARKER_MODEL_ID ?? fileDefaults.app.modelId,
    modelOwner: env.TRANSPARKER_MODEL_OWNER ?? fileDefaults.app.modelOwner
  };
}
