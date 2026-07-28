import { z } from 'zod';

/** Shape of the ingest-emitted rule-ids.json, validated like every other generated artifact. */
export const RuleIdsSchema = z.array(z.string().min(1));

const files = import.meta.glob('$content/rulesets/*/rule-ids.json', { eager: true }) as Record<
	string,
	{ default: unknown }
>;

const sets = new Map<string, ReadonlySet<string>>();
for (const [path, mod] of Object.entries(files)) {
	const match = path.match(/\/rulesets\/([^/]+)\//);
	if (match) sets.set(match[1], new Set(RuleIdsSchema.parse(mod.default)));
}

const EMPTY: ReadonlySet<string> = new Set();

/** Every rule id + section anchor of a ruleset (ingest-emitted rule-ids.json). */
export function ruleIdSet(rulesetId: string): ReadonlySet<string> {
	return sets.get(rulesetId) ?? EMPTY;
}
