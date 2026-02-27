function splitLines(value: string): string[] {
	return value.replace(/\r\n/g, "\n").split("\n");
}

export function buildPrompt(template: string, transcript: string, knownTerms: string): string {
	const out: string[] = [];
	const knownTermLines = splitLines(knownTerms);
	const transcriptLines = splitLines(transcript);

	for (const line of splitLines(template)) {
		if (line === "{{KNOWN_DOMAIN_TERMS}}") {
			out.push(...knownTermLines);
			continue;
		}
		if (line === "{{TRANSCRIPT}}") {
			out.push(...transcriptLines);
			continue;
		}
		out.push(line);
	}

	return out.join("\n");
}
