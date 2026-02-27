import { readdir, readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

interface SessionSnapshot {
	readonly file: string;
	readonly payloadStartedAt: number;
	readonly firstEventAt: number;
	readonly sessionId: string;
	readonly eventCount: number;
	readonly hasTaskComplete: boolean;
	readonly taskCompletedAt: number | null;
}

interface SessionMeta {
	readonly payloadStartedAt: number;
	readonly firstEventAt: number;
	readonly sessionId: string;
}

function isObject(value: unknown): value is object {
	return typeof value === "object" && value !== null;
}

function readString(value: object, key: string): string | null {
	const out = Reflect.get(value, key);
	return typeof out === "string" ? out : null;
}

function readObject(value: object, key: string): object | null {
	const out = Reflect.get(value, key);
	return isObject(out) ? out : null;
}

function toIsoDatePath(timestampMs: number): string {
	const date = new Date(timestampMs);
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}/${month}/${day}`;
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

function parseJsonObject(line: string): object | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return null;
	}
	return isObject(parsed) ? parsed : null;
}

function parseSessionMeta(line: string): SessionMeta | null {
	const parsed = parseJsonObject(line);
	if (!parsed) {
		return null;
	}

	if (readString(parsed, "type") !== "session_meta") {
		return null;
	}

	const firstEventTsRaw = readString(parsed, "timestamp");
	const payload = readObject(parsed, "payload");
	if (!payload || !firstEventTsRaw) {
		return null;
	}

	const payloadStartRaw = readString(payload, "timestamp");
	if (!payloadStartRaw) {
		return null;
	}

	const firstEventAt = Date.parse(firstEventTsRaw);
	const payloadStartedAt = Date.parse(payloadStartRaw);
	if (!Number.isFinite(firstEventAt) || !Number.isFinite(payloadStartedAt)) {
		return null;
	}

	return {
		payloadStartedAt,
		firstEventAt,
		sessionId: readString(payload, "id") ?? "unknown",
	};
}

function parseTaskCompleteTimestamp(line: string): number | null {
	const parsed = parseJsonObject(line);
	if (!parsed) {
		return null;
	}

	if (readString(parsed, "type") !== "event_msg") {
		return null;
	}
	if (!readString(parsed, "timestamp")) {
		return null;
	}

	const payload = readObject(parsed, "payload");
	if (!payload || readString(payload, "type") !== "task_complete") {
		return null;
	}

	const timestamp = readString(parsed, "timestamp");
	if (!timestamp) {
		return null;
	}

	const completedAt = Date.parse(timestamp);
	return Number.isFinite(completedAt) ? completedAt : null;
}

function collectTaskCompleteStats(lines: string[]): {
	hasTaskComplete: boolean;
	taskCompletedAt: number | null;
} {
	let hasTaskComplete = false;
	let taskCompletedAt: number | null = null;

	for (const line of lines) {
		const completedAt = parseTaskCompleteTimestamp(line);
		if (completedAt === null) {
			continue;
		}
		hasTaskComplete = true;
		taskCompletedAt = completedAt;
	}

	return {
		hasTaskComplete,
		taskCompletedAt,
	};
}

async function listSessionFiles(
	codexHomePath: string,
	startedAtMs: number,
	endedAtMs: number,
): Promise<string[]> {
	const sessionsRoot = resolve(codexHomePath, "sessions");
	const dayMs = 24 * 60 * 60 * 1000;
	const dayPaths = unique([
		toIsoDatePath(startedAtMs - dayMs),
		toIsoDatePath(startedAtMs),
		toIsoDatePath(startedAtMs + dayMs),
		toIsoDatePath(endedAtMs),
	]);

	const files: string[] = [];
	for (const dayPath of dayPaths) {
		const dayDir = resolve(sessionsRoot, dayPath);
		if (!(await exists(dayDir))) {
			continue;
		}

		const entries = await readdir(dayDir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.isFile() && entry.name.endsWith(".jsonl")) {
				files.push(resolve(dayDir, entry.name));
			}
		}
	}

	return files;
}

async function loadSessionSnapshot(filePath: string): Promise<SessionSnapshot | null> {
	const text = await readFile(filePath, "utf8");
	if (text.trim().length === 0) {
		return null;
	}

	const lines = text.split("\n").filter((line) => line.trim().length > 0);
	if (lines.length === 0) {
		return null;
	}

	const meta = parseSessionMeta(lines[0]);
	if (!meta) {
		return null;
	}

	const completion = collectTaskCompleteStats(lines);
	return {
		file: basename(filePath),
		payloadStartedAt: meta.payloadStartedAt,
		firstEventAt: meta.firstEventAt,
		sessionId: meta.sessionId,
		eventCount: lines.length,
		hasTaskComplete: completion.hasTaskComplete,
		taskCompletedAt: completion.taskCompletedAt,
	};
}

function pickClosestSession(candidates: SessionSnapshot[], startedAtMs: number): SessionSnapshot {
	return candidates.reduce((best, current) => {
		const bestDelta = Math.abs(best.payloadStartedAt - startedAtMs);
		const currentDelta = Math.abs(current.payloadStartedAt - startedAtMs);
		return currentDelta < bestDelta ? current : best;
	});
}

export async function collectSessionDiagnostics(
	codexHomePath: string,
	startedAtMs: number,
	endedAtMs: number,
): Promise<Record<string, unknown>> {
	const sessionFiles = await listSessionFiles(codexHomePath, startedAtMs, endedAtMs);
	if (sessionFiles.length === 0) {
		return { session_found: false };
	}

	const snapshots = (
		await Promise.all(sessionFiles.map(async (filePath) => loadSessionSnapshot(filePath)))
	).filter((snapshot): snapshot is SessionSnapshot => snapshot !== null);
	if (snapshots.length === 0) {
		return { session_found: false };
	}

	const windowStartMs = startedAtMs - 5_000;
	const windowEndMs = endedAtMs + 5_000;
	const candidates = snapshots.filter(
		(snapshot) =>
			snapshot.payloadStartedAt >= windowStartMs && snapshot.payloadStartedAt <= windowEndMs,
	);
	if (candidates.length === 0) {
		return { session_found: false };
	}

	const closest = pickClosestSession(candidates, startedAtMs);
	return {
		session_found: true,
		session_id: closest.sessionId,
		session_file: closest.file,
		session_boot_gap_ms: Math.max(0, closest.firstEventAt - closest.payloadStartedAt),
		session_active_ms: closest.taskCompletedAt === null
			? null
			: Math.max(0, closest.taskCompletedAt - closest.firstEventAt),
		session_has_task_complete: closest.hasTaskComplete,
		session_event_count: closest.eventCount,
	};
}
