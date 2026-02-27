export function parseInteger(raw: string | undefined): number | undefined {
	if (!raw) {
		return undefined;
	}

	const parsed = Number.parseInt(raw, 10);
	return Number.isInteger(parsed) ? parsed : undefined;
}

export function parseBooleanish(raw: string | undefined): boolean | undefined {
	if (!raw) {
		return undefined;
	}

	const normalized = raw.trim().toLowerCase();
	if (["1", "true", "yes", "on"].includes(normalized)) {
		return true;
	}
	if (["0", "false", "no", "off"].includes(normalized)) {
		return false;
	}
	return undefined;
}
