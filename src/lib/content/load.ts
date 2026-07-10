import { SectionSchema, GlossaryEntrySchema, type GlossaryEntry, type Section } from './types';
import { z } from 'zod';
import { getManifest } from './manifests';

export { listRulesets, getManifest } from './manifests';

const sections = import.meta.glob('$content/rulesets/*/sections/*.json', {
	eager: true
}) as Record<string, { default: unknown }>;
const glossaries = import.meta.glob('$content/rulesets/*/glossary.json', {
	eager: true
}) as Record<string, { default: unknown }>;

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
