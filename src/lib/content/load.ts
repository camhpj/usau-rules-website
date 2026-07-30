import { SectionSchema, GlossaryEntrySchema, type GlossaryEntry, type Section } from './types';
import { z } from 'zod';
import { getManifest } from './manifests';

export { listRulesets, getManifest } from './manifests';

const sections = import.meta.glob('$content/rulesets/*/sections/*.json') as Record<
	string,
	() => Promise<{ default: unknown }>
>;
const glossaries = import.meta.glob('$content/rulesets/*/glossary.json') as Record<
	string,
	() => Promise<{ default: unknown }>
>;

// Parsed sections are cached per key: a section's content is fixed at build time,
// and re-validating it on every client-side navigation is wasted work.
const sectionCache = new Map<string, Section>();
const glossaryCache = new Map<string, GlossaryEntry[]>();

export async function getSection(rulesetId: string, slug: string): Promise<Section> {
	getManifest(rulesetId);
	const cacheKey = `${rulesetId}/${slug}`;
	const cached = sectionCache.get(cacheKey);
	if (cached) return cached;
	const key = Object.keys(sections).find((k) => k.includes(`/${rulesetId}/sections/${slug}.json`));
	if (!key) throw new Error(`unknown section: ${rulesetId}/${slug}`);
	const parsed = SectionSchema.parse((await sections[key]()).default);
	sectionCache.set(cacheKey, parsed);
	return parsed;
}

export async function getGlossary(rulesetId: string): Promise<GlossaryEntry[]> {
	const cached = glossaryCache.get(rulesetId);
	if (cached) return cached;
	const key = Object.keys(glossaries).find((k) => k.includes(`/${rulesetId}/glossary.json`));
	if (!key) throw new Error(`unknown ruleset: ${rulesetId}`);
	const parsed = z.array(GlossaryEntrySchema).parse((await glossaries[key]()).default);
	glossaryCache.set(rulesetId, parsed);
	return parsed;
}
