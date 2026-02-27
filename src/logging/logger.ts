type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};

function isLogLevel(value: string): value is LogLevel {
	return value in LEVEL_ORDER;
}

export interface LogMeta {
	readonly [key: string]: unknown;
}

export class Logger {
	private readonly threshold: number;

	constructor(level: string) {
		const normalized = level.toLowerCase();
		if (!isLogLevel(normalized)) {
			this.threshold = LEVEL_ORDER.info;
			return;
		}
		this.threshold = LEVEL_ORDER[normalized];
	}

	debug(message: string, meta: LogMeta = {}): void {
		this.write("debug", message, meta);
	}

	info(message: string, meta: LogMeta = {}): void {
		this.write("info", message, meta);
	}

	warn(message: string, meta: LogMeta = {}): void {
		this.write("warn", message, meta);
	}

	error(message: string, meta: LogMeta = {}): void {
		this.write("error", message, meta);
	}

	private write(level: LogLevel, message: string, meta: LogMeta): void {
		if (LEVEL_ORDER[level] < this.threshold) {
			return;
		}

		const payload = {
			ts: new Date().toISOString(),
			level,
			message,
			...meta,
		};

		console.log(JSON.stringify(payload));
	}
}

export function previewText(text: string, maxChars = 160): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (normalized.length <= maxChars) {
		return normalized;
	}

	return `${normalized.slice(0, maxChars)}...`;
}
