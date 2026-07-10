import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ManifestSchema, SectionSchema, type Manifest } from '../../src/lib/content/types';
import { RULESETS } from './config';
import { parseRulesHtml } from './parse';
import {
	buildGrounding,
	buildSearchIndexJson,
	collectImageUrls,
	extractGlossary,
	rewriteCrossRefs,
	rewriteImageUrls,
	wrapGlossaryTerms
} from './transform';

const UA = 'Mozilla/5.0 (compatible; BestPerspective ingest; +https://github.com/camhpj)';
const refetch = process.argv.includes('--refetch');

async function fetchText(url: string): Promise<string> {
	const res = await fetch(url, { headers: { 'user-agent': UA } });
	if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
	return res.text();
}

for (const cfg of RULESETS) {
	const snapshotPath = join('content/sources', `${cfg.id}.html`);
	mkdirSync('content/sources', { recursive: true });
	if (refetch || !existsSync(snapshotPath)) {
		console.log(`fetching ${cfg.sourceUrl}`);
		writeFileSync(snapshotPath, await fetchText(cfg.sourceUrl));
	}
	const { sections } = parseRulesHtml(readFileSync(snapshotPath, 'utf8'));

	rewriteCrossRefs(sections, cfg.id);
	const glossary = extractGlossary(sections);
	wrapGlossaryTerms(sections, glossary);

	// images → static/rules-media
	mkdirSync('static/rules-media', { recursive: true });
	const urlMap = new Map<string, string>();
	for (const url of collectImageUrls(sections)) {
		const name = basename(new URL(url).pathname);
		const local = join('static/rules-media', name);
		if (!existsSync(local)) {
			console.log(`downloading ${name}`);
			const res = await fetch(url, { headers: { 'user-agent': UA } });
			if (!res.ok) throw new Error(`${res.status} downloading ${url}`);
			writeFileSync(local, Buffer.from(await res.arrayBuffer()));
		}
		urlMap.set(url, `/rules-media/${name}`);
	}
	rewriteImageUrls(sections, urlMap);

	const manifest: Manifest = {
		id: cfg.id,
		title: cfg.title,
		shortTitle: cfg.shortTitle,
		edition: cfg.edition,
		sourceUrl: cfg.sourceUrl,
		sectionScheme: cfg.sectionScheme,
		fetchedAt: new Date().toISOString(),
		sections: sections.map((s) => ({
			slug: s.slug,
			number: s.number,
			kind: s.kind,
			title: s.title,
			ruleCount: countRules(s)
		}))
	};

	const dir = join('content/rulesets', cfg.id);
	mkdirSync(join(dir, 'sections'), { recursive: true });
	writeFileSync(
		join(dir, 'manifest.json'),
		JSON.stringify(ManifestSchema.parse(manifest), null, '\t')
	);
	for (const s of sections) {
		writeFileSync(
			join(dir, 'sections', `${s.slug}.json`),
			JSON.stringify(SectionSchema.parse(s), null, '\t')
		);
	}
	writeFileSync(join(dir, 'glossary.json'), JSON.stringify(glossary, null, '\t'));
	writeFileSync(
		join(dir, 'grounding.txt'),
		buildGrounding(sections, `${cfg.title} (${cfg.edition})\nSource: ${cfg.sourceUrl}`)
	);
	mkdirSync('static/search', { recursive: true });
	writeFileSync(join('static/search', `${cfg.id}.json`), buildSearchIndexJson(sections));

	const total = manifest.sections.reduce((n, s) => n + s.ruleCount, 0);
	console.log(
		`✓ ${cfg.id}: ${manifest.sections.length} sections, ${total} rules, ${glossary.length} glossary terms`
	);
}

function countRules(s: { rules: { children: unknown[] }[] }): number {
	let n = 0;
	const walk = (nodes: { children: unknown[] }[]) => {
		for (const node of nodes) {
			n++;
			walk(node.children as never);
		}
	};
	walk(s.rules as never);
	return n;
}
