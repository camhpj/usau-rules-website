const files = import.meta.glob('$content/rulesets/*/rule-ids.json', { eager: true }) as Record<
	string,
	{ default: string[] }
>;

const sets = new Map<string, ReadonlySet<string>>();
for (const [path, mod] of Object.entries(files)) {
	const match = path.match(/\/rulesets\/([^/]+)\//);
	if (match) sets.set(match[1], new Set(mod.default));
}

const EMPTY: ReadonlySet<string> = new Set();

/** Every rule id + section anchor of a ruleset (ingest-emitted rule-ids.json). */
export function ruleIdSet(rulesetId: string): ReadonlySet<string> {
	return sets.get(rulesetId) ?? EMPTY;
}
