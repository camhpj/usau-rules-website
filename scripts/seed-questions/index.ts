import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ManifestSchema, SectionSchema, type Section } from '../../src/lib/content/types';
import { collectRuleIds } from '../../src/lib/content/rule-ids';
import { DEFAULT_RULESET_ID } from '../../src/lib/content/config';
import { QuestionSchema, type Question } from '../../src/lib/quiz/types';
import { SEED_DEFAULTS } from './config';
import { sliceGrounding } from './grounding';
import { generateSection, type SectionJob } from './generate';
import { computeTargets, uncoveredTargets, type Target } from './targets';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const values = (name: string) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []));

const force = flag('force');
const report = flag('report');
const onlySections = values('section');
const model = values('model')[0] ?? SEED_DEFAULTS.model;
const rulesetId = values('ruleset')[0] ?? DEFAULT_RULESET_ID;

if (!report) {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) {
		console.error('GEMINI_API_KEY is required (get one at https://aistudio.google.com/apikey)');
		process.exit(1);
	}
}

async function callGemini(prompt: string): Promise<string> {
	const apiKey = process.env.GEMINI_API_KEY!;
	const res = await fetch(
		`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
		{
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
			body: JSON.stringify({
				contents: [{ parts: [{ text: prompt }] }],
				// Reasoning models spend thinking tokens from the same output budget;
				// without an explicit cap the default can truncate long JSON mid-array.
				generationConfig: {
					responseMimeType: 'application/json',
					temperature: 0.7,
					maxOutputTokens: 65536
				}
			})
		}
	);
	if (!res.ok) throw new Error(`${res.status} from Gemini: ${(await res.text()).slice(0, 300)}`);
	const data = (await res.json()) as {
		candidates?: {
			content?: { parts?: { text?: string; thought?: boolean }[] };
			finishReason?: string;
		}[];
	};
	const candidate = data.candidates?.[0];
	const text =
		candidate?.content?.parts
			?.filter((p) => !p.thought)
			.map((p) => p.text ?? '')
			.join('') ?? '';
	if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
		throw new Error(
			`Gemini stopped with finishReason=${candidate.finishReason} (${text.length} chars received)`
		);
	}
	if (!text) throw new Error('empty response from Gemini');
	return text;
}

const dir = join('content/rulesets', rulesetId);
const manifest = ManifestSchema.parse(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')));
const sections: Section[] = manifest.sections.map((entry) =>
	SectionSchema.parse(JSON.parse(readFileSync(join(dir, 'sections', `${entry.slug}.json`), 'utf8')))
);
const ruleIds = collectRuleIds(sections);
const grounding = readFileSync(join(dir, 'grounding.txt'), 'utf8');
const outDir = join('content/questions', rulesetId);
mkdirSync(outDir, { recursive: true });

const sectionEntries = manifest.sections.filter(
	(s) =>
		s.kind === 'section' &&
		s.ruleCount > 0 &&
		(onlySections.length === 0 || onlySections.includes(s.slug))
);

// Targets are scored over numbered rule sections only (preface/appendix content isn't part of
// the quiz coverage ceiling); ruleIds above still spans every section so cross-references into
// the preface/appendix validate correctly.
const numberedSections = sections.filter((s) => s.kind === 'section');
const allTargets = computeTargets(numberedSections, {
	threshold: SEED_DEFAULTS.targetThreshold,
	minTextLength: SEED_DEFAULTS.minTargetTextLength,
	exclude: SEED_DEFAULTS.excludeTargets
});

// Coverage is always derived fresh from whatever is on disk right now — --force (optionally
// scoped by --section) excludes the affected files' questions, as if they didn't exist yet.
const forcedSlugs = new Set(
	force ? (onlySections.length ? onlySections : sectionEntries.map((s) => s.slug)) : []
);
const existingBySection = new Map<string, Question[]>();
for (const entry of manifest.sections) {
	const outPath = join(outDir, `${entry.slug}.json`);
	const questions: Question[] =
		existsSync(outPath) && !forcedSlugs.has(entry.slug)
			? z.array(QuestionSchema).parse(JSON.parse(readFileSync(outPath, 'utf8')))
			: [];
	existingBySection.set(entry.slug, questions);
}
const allExisting = [...existingBySection.values()].flat();

function printCoverageReport(
	targets: Target[],
	existing: Question[],
	sections: typeof sectionEntries
): void {
	const uncovered = uncoveredTargets(targets, existing);
	const uncoveredIds = new Set(uncovered.map((t) => t.id));
	console.log('\nCoverage report:');
	for (const entry of sections) {
		const sectionTargets = targets.filter((t) => t.sectionSlug === entry.slug);
		if (sectionTargets.length === 0) continue;
		const coveredCount = sectionTargets.filter((t) => !uncoveredIds.has(t.id)).length;
		console.log(
			`  ${entry.slug} (${entry.title}): ${coveredCount}/${sectionTargets.length} targets`
		);
	}
	const total = targets.length;
	const covered = total - uncovered.length;
	const pct = total === 0 ? 100 : Math.round((covered / total) * 100);
	console.log(`\nOverall: ${covered}/${total} (${pct}%)`);
	if (covered === total) console.log(`saturated — all ${total} targets covered`);
}

if (report) {
	printCoverageReport(allTargets, allExisting, sectionEntries);
	process.exit(0);
}

const uncoveredAll = uncoveredTargets(allTargets, allExisting);
if (uncoveredAll.length === 0) {
	console.log(`saturated — all ${allTargets.length} targets covered`);
	process.exit(0);
}

const unfulfilledThisRun: string[] = [];

for (const entry of sectionEntries) {
	const existing = existingBySection.get(entry.slug) ?? [];
	const sectionTargets = allTargets.filter((t) => t.sectionSlug === entry.slug);
	const uncoveredSection = uncoveredTargets(sectionTargets, allExisting);
	if (uncoveredSection.length === 0) {
		console.log(`• ${entry.slug} (${entry.title}): all targets covered — skipping`);
		continue;
	}
	const requested = uncoveredSection
		.slice()
		.sort((a, b) => b.score - a.score)
		.slice(0, SEED_DEFAULTS.targetsPerSectionPerRun);
	const job: SectionJob = {
		rulesetId,
		sectionSlug: entry.slug,
		sectionTitle: `${entry.number}. ${entry.title}`,
		grounding: sliceGrounding(grounding, entry.number!, entry.title),
		targets: requested,
		existing
	};
	const { questions, rejected, unfulfilled } = await generateSection(job, ruleIds, callGemini);
	for (const reason of rejected) console.warn(`  ! ${entry.slug}: ${reason}`);
	const merged = [...existing, ...questions];
	writeFileSync(join(outDir, `${entry.slug}.json`), JSON.stringify(merged, null, '\t') + '\n');
	existingBySection.set(entry.slug, merged);
	const fulfilledCount = requested.length - unfulfilled.length;
	console.log(
		`✓ ${entry.slug} (${entry.title}): +${questions.length} → ${merged.length} total (${fulfilledCount}/${requested.length} requested targets fulfilled)`
	);
	unfulfilledThisRun.push(...unfulfilled);
}

const finalExisting = [...existingBySection.values()].flat();
if (unfulfilledThisRun.length > 0) {
	console.log(`\nrequested but unfulfilled this run:\n  ${unfulfilledThisRun.join(', ')}`);
}
printCoverageReport(allTargets, finalExisting, sectionEntries);

console.log(
	'\nDone. REVIEW every generated question before committing, then run: npm run validate:content'
);
