const files = import.meta.glob('$content/rulesets/*/grounding.txt', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

/** Full-rulebook grounding text for a ruleset, or null when none is bundled. */
export function groundingFor(rulesetId: string): string | null {
	const entry = Object.entries(files).find(([path]) => path.includes(`/rulesets/${rulesetId}/`));
	return entry?.[1] ?? null;
}
