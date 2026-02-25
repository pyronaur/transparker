function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export async function processTranscript(text: string): Promise<string> {
  await Bun.sleep(2000);
  return normalizeWhitespace(text);
}
