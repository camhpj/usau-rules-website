/** Latest `**Headline**` marker in accumulated thought-summary text, or null. */
export function latestThoughtHeadline(thoughts: string): string | null {
	const matches = thoughts.matchAll(/\*\*([^*\n]{1,80})\*\*/g);
	let last: string | null = null;
	for (const match of matches) last = match[1];
	return last ? last.trim() : null;
}
