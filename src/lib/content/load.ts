import {
	ManifestSchema,
	SectionSchema,
	GlossaryEntrySchema,
	type GlossaryEntry,
	type Manifest,
	type Section
} from './types';
import { z } from 'zod';

const manifests = import.meta.glob('$content/rulesets/*/manifest.json', {
	eager: true
}) as Record<string, { default: unknown }>;
const sections = import.meta.glob('$content/rulesets/*/sections/*.json', {
	eager: true
}) as Record<string, { default: unknown }>;
const glossaries = import.meta.glob('$content/rulesets/*/glossary.json', {
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

export function getSection(rulesetId: string, slug: string): Section {
	getManifest(rulesetId);
	const key = Object.keys(sections).find((k) => k.includes(`/${rulesetId}/sections/${slug}.json`));
	if (!key) throw new Error(`unknown section: ${rulesetId}/${slug}`);
	return SectionSchema.parse(sections[key].default);
}

export function getGlossary(rulesetId: string): GlossaryEntry[] {
	const key = Object.keys(glossaries).find((k) => k.includes(`/${rulesetId}/glossary.json`));
	if (!key) throw new Error(`unknown ruleset: ${rulesetId}`);
	return z.array(GlossaryEntrySchema).parse(glossaries[key].default);
}
