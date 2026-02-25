export interface AppConfig {
  readonly port: number;
  readonly host: string;
  readonly logLevel: string;
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: parsePort(env.PORT, 43113),
    host: env.HOST ?? "127.0.0.1",
    logLevel: env.LOG_LEVEL ?? "info",
    modelId: env.TRANSPARKER_MODEL_ID ?? "Transparker",
    modelOwner: env.TRANSPARKER_MODEL_OWNER ?? "transparker-local"
  };
}
