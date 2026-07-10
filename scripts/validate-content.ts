import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import {
	GlossaryEntrySchema,
	ManifestSchema,
	SectionSchema,
	type Section
} from '../src/lib/content/types';
import { collectRuleIds } from '../src/lib/content/rule-ids';
import { QuestionSchema } from '../src/lib/quiz/types';

const root = 'content/rulesets';
if (!existsSync(root)) {
	console.log('no content yet — skipping');
	process.exit(0);
}

const sectionsByRuleset = new Map<string, Section[]>();
let checked = 0;
for (const id of readdirSync(root)) {
	const dir = join(root, id);
	const manifest = ManifestSchema.parse(
		JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
	);
	if (manifest.id !== id) throw new Error(`manifest id ${manifest.id} != dir ${id}`);
	const sections: Section[] = [];
	for (const entry of manifest.sections) {
		const section = SectionSchema.parse(
			JSON.parse(readFileSync(join(dir, 'sections', `${entry.slug}.json`), 'utf8'))
		);
		if (section.slug !== entry.slug) throw new Error(`slug mismatch in ${id}/${entry.slug}`);
		sections.push(section);
		checked++;
	}
	z.array(GlossaryEntrySchema).parse(JSON.parse(readFileSync(join(dir, 'glossary.json'), 'utf8')));
	sectionsByRuleset.set(id, sections);
}
console.log(`✓ content valid (${checked} sections)`);

const questionsRoot = 'content/questions';
let questionCount = 0;
if (existsSync(questionsRoot)) {
	for (const rulesetId of readdirSync(questionsRoot)) {
		const sections = sectionsByRuleset.get(rulesetId);
		if (!sections) throw new Error(`questions for unknown ruleset: ${rulesetId}`);
		const ruleIds = collectRuleIds(sections);
		const sectionSlugs = new Set(sections.map((s) => s.slug));
		const seenIds = new Set<string>();
		const seenPrompts = new Set<string>();
		for (const file of readdirSync(join(questionsRoot, rulesetId))) {
			const slug = basename(file, '.json');
			const questions = z
				.array(QuestionSchema)
				.parse(JSON.parse(readFileSync(join(questionsRoot, rulesetId, file), 'utf8')));
			for (const q of questions) {
				const ctx = `${rulesetId}/${file} ${q.id}`;
				if (q.rulesetId !== rulesetId) throw new Error(`${ctx}: rulesetId mismatch`);
				if (q.sectionSlug !== slug) throw new Error(`${ctx}: sectionSlug != file name`);
				if (!sectionSlugs.has(q.sectionSlug)) throw new Error(`${ctx}: unknown section`);
				if (seenIds.has(q.id)) throw new Error(`${ctx}: duplicate question id`);
				seenIds.add(q.id);
				const prompt = q.prompt.toLowerCase();
				if (seenPrompts.has(prompt)) throw new Error(`${ctx}: duplicate prompt`);
				seenPrompts.add(prompt);
				if (new Set(q.choices).size !== q.choices.length)
					throw new Error(`${ctx}: duplicate choices`);
				for (const ref of q.ruleRefs) {
					if (!ruleIds.has(ref)) throw new Error(`${ctx}: unknown ruleRef ${ref}`);
				}
				questionCount++;
			}
		}
	}
	console.log(`✓ questions valid (${questionCount} questions)`);
}
