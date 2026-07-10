import { ManifestSchema, type Manifest } from './types';

const manifests = import.meta.glob('$content/rulesets/*/manifest.json', {
	eager: true
}) as Record<string, { default: unknown }>;

const byId = new Map<string, Manifest>();
for (const mod of Object.values(manifests)) {
	const m = ManifestSchema.parse(mod.default);
	byId.set(m.id, m);
}

export function listRulesets(): Manifest[] {
	return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function getManifest(rulesetId: string): Manifest {
	const m = byId.get(rulesetId);
	if (!m) throw new Error(`unknown ruleset: ${rulesetId}`);
	return m;
}
