import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ManifestSchema, SectionSchema, GlossaryEntrySchema } from '../src/lib/content/types';
import { z } from 'zod';

const root = 'content/rulesets';
if (!existsSync(root)) {
	console.log('no content yet — skipping');
	process.exit(0);
}
let checked = 0;
for (const id of readdirSync(root)) {
	const dir = join(root, id);
	const manifest = ManifestSchema.parse(
		JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
	);
	if (manifest.id !== id) throw new Error(`manifest id ${manifest.id} != dir ${id}`);
	for (const entry of manifest.sections) {
		const section = SectionSchema.parse(
			JSON.parse(readFileSync(join(dir, 'sections', `${entry.slug}.json`), 'utf8'))
		);
		if (section.slug !== entry.slug) throw new Error(`slug mismatch in ${id}/${entry.slug}`);
		checked++;
	}
	z.array(GlossaryEntrySchema).parse(JSON.parse(readFileSync(join(dir, 'glossary.json'), 'utf8')));
}
console.log(`✓ content valid (${checked} sections)`);
