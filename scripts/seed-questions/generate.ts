import { z } from 'zod';
import type { Question } from '../../src/lib/quiz/types';
import { SEED_DEFAULTS } from './config';
import type { Target } from './targets';

export interface Draft {
	prompt: string;
	choices: string[];
	answerIndex: number;
	explanation: string;
	ruleRefs: string[];
	difficulty: 1 | 2 | 3;
}

export const DraftSchema: z.ZodType<Draft> = z.object({
	prompt: z.string().min(10),
	choices: z.array(z.string().min(1)).length(4),
	answerIndex: z.number().int().min(0).max(3),
	explanation: z.string().min(10),
	ruleRefs: z.array(z.string().min(1)).min(1),
	difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)])
});

export interface SectionJob {
	rulesetId: string;
	sectionSlug: string;
	sectionTitle: string;
	grounding: string;
	targets: Target[];
	existing: Question[];
}

/** True iff `ref` cites `targetId` itself or a descendant rule of it. */
function fulfills(ref: string, targetId: string): boolean {
	return ref === targetId || ref.startsWith(targetId + '.');
}

const EXAMPLE_DRAFT: Draft = {
	prompt:
		'The thrower still has the disc when the marker first utters the word “ten” in a legal stall count. What is the result?',
	choices: [
		'It is a turnover — the marker loudly announces “stall” and play stops.',
		'The marker restarts the stall count at eight.',
		'The thrower receives a warning and the count continues.',
		'Play continues until the thrower attempts a pass.'
	],
	answerIndex: 0,
	explanation:
		'Under 15.D, if the thrower has not released the disc at the first utterance of the word “ten,” it is a turnover: the marker loudly announces “stall” and play stops.',
	ruleRefs: ['15.D'],
	difficulty: 1
};

export function buildPrompt(job: SectionJob, targets: Target[], avoidPrompts: string[]): string {
	const avoid = avoidPrompts.map((p) => `- ${p}`).join('\n');
	const targetList = targets.map((t, i) => `${i + 1}. [${t.id}] ${t.text}`).join('\n');
	return `You are writing multiple-choice quiz questions for a study tool covering the USA Ultimate Official Rules of Ultimate.

Write exactly one question for EACH of the ${targets.length} target rules listed below, from Section ${job.sectionTitle}, using ONLY the rule text under RULE TEXT as your source of truth. Do not use outside knowledge of other rulebooks (WFDF, older USAU editions); if the text below does not support a question for a target, skip that target rather than inventing one.

Target rules (highest priority first — write one question per target):
${targetList}

Requirements for every question:
- "prompt": a clear, self-contained question grounded in its target rule. Prefer concrete game situations over definition recall where the rules support them.
- "choices": exactly 4 options. Exactly one is correct per the rule text; the other three are plausible but wrong (common misconceptions, near-miss numbers, rules from adjacent situations). Never use "all of the above" or "none of the above".
- "answerIndex": 0-based index of the correct choice.
- "explanation": 1-3 sentences explaining the correct answer, paraphrasing the rule and naming the rule ids used.
- "ruleRefs": the exact rule ids (e.g. "15.D", "9.F.4.b.1") that ground the answer. MUST include the target rule id itself or one of its sub-rule ids (e.g. "15.D.1" for target "15.D"); you may also cite closely related rules. Every id MUST appear verbatim inside square brackets in the rule text below.
- "difficulty": 1 (new players — core concepts), 2 (club players — situational judgment), or 3 (rules experts — precise details, numbers, edge cases). ${SEED_DEFAULTS.difficultyMix}
${avoid ? `\nDo NOT duplicate or closely paraphrase any of these existing questions:\n${avoid}\n` : ''}
Return ONLY a JSON array of question objects shaped exactly like this example:
${JSON.stringify([EXAMPLE_DRAFT], null, 2)}

RULE TEXT (Section ${job.sectionTitle}):
${job.grounding}`;
}

export function validateDrafts(
	raw: unknown,
	avoidPrompts: string[],
	ruleIds: Set<string>,
	targets: Target[]
): { valid: Draft[]; rejected: string[] } {
	const parsed = z.array(z.unknown()).safeParse(raw);
	if (!parsed.success) return { valid: [], rejected: ['response is not a JSON array'] };
	const valid: Draft[] = [];
	const rejected: string[] = [];
	const seenPrompts = new Set(avoidPrompts.map((p) => p.toLowerCase()));
	for (const [i, item] of parsed.data.entries()) {
		const result = DraftSchema.safeParse(item);
		if (!result.success) {
			rejected.push(`draft ${i}: ${result.error.issues[0]?.message ?? 'schema error'}`);
			continue;
		}
		const draft = result.data;
		const badRef = draft.ruleRefs.find((ref) => !ruleIds.has(ref));
		if (badRef) {
			rejected.push(`draft ${i} ("${draft.prompt.slice(0, 40)}…"): unknown ruleRef ${badRef}`);
			continue;
		}
		if (new Set(draft.choices).size !== draft.choices.length) {
			rejected.push(`draft ${i}: duplicate choices`);
			continue;
		}
		if (seenPrompts.has(draft.prompt.toLowerCase())) {
			rejected.push(`draft ${i}: duplicate prompt`);
			continue;
		}
		const fulfillsAny = draft.ruleRefs.some((ref) => targets.some((t) => fulfills(ref, t.id)));
		if (!fulfillsAny) {
			rejected.push(`draft ${i} ("${draft.prompt.slice(0, 40)}…"): fulfills no requested target`);
			continue;
		}
		seenPrompts.add(draft.prompt.toLowerCase());
		valid.push(draft);
	}
	return { valid, rejected };
}

export function toQuestions(drafts: Draft[], job: SectionJob): Question[] {
	let n = job.existing.reduce((max, q) => {
		const match = q.id.match(/-(\d+)$/);
		return match ? Math.max(max, Number(match[1])) : max;
	}, 0);
	return drafts.map((draft) => ({
		id: `${job.sectionSlug}-${String(++n).padStart(2, '0')}`,
		rulesetId: job.rulesetId,
		type: 'multiple-choice',
		sectionSlug: job.sectionSlug,
		...draft
	}));
}

/**
 * Parse a model response as a JSON array, salvaging the valid prefix when the
 * response is malformed partway through (missing comma, stray text, truncation).
 * Throws the original error — with a context snippet — when nothing is salvageable.
 */
export function parseDraftArray(rawText: string): { value: unknown; salvaged: boolean } {
	try {
		return { value: JSON.parse(rawText), salvaged: false };
	} catch (error) {
		const message = (error as Error).message;
		// Walk back through draft-object boundaries until a prefix parses as a
		// non-empty array. Position-based cuts are unreliable: truncation errors
		// ("Unexpected end of JSON input") carry no position at all.
		let idx = rawText.lastIndexOf('}');
		while (idx > 0) {
			if (rawText.trimStart().startsWith('[')) {
				try {
					const value = JSON.parse(rawText.slice(0, idx + 1).trimStart() + ']');
					if (Array.isArray(value) && value.length > 0) return { value, salvaged: true };
				} catch {
					// keep walking back
				}
			}
			idx = rawText.lastIndexOf('}', idx - 1);
		}
		const position = /position (\d+)/.exec(message);
		const cut = position ? Number(position[1]) : rawText.length;
		const context = rawText.slice(Math.max(0, cut - 120), cut + 120);
		throw new Error(`${message} — context around failure: ${JSON.stringify(context)}`);
	}
}

export async function generateSection(
	job: SectionJob,
	ruleIds: Set<string>,
	callModel: (prompt: string) => Promise<string>
): Promise<{ questions: Question[]; rejected: string[]; unfulfilled: string[] }> {
	const accepted: Draft[] = [];
	const rejected: string[] = [];
	let remaining = job.targets;
	for (let attempt = 0; attempt < 2 && remaining.length > 0; attempt++) {
		const avoid = [...job.existing.map((q) => q.prompt), ...accepted.map((d) => d.prompt)];
		const prompt = buildPrompt(job, remaining, avoid);
		let raw: unknown;
		try {
			const parsed = parseDraftArray(await callModel(prompt));
			raw = parsed.value;
			if (parsed.salvaged) {
				rejected.push(
					`attempt ${attempt + 1}: malformed JSON — salvaged ${(raw as unknown[]).length} draft(s) from valid prefix`
				);
			}
		} catch (error) {
			rejected.push(`attempt ${attempt + 1}: ${(error as Error).message}`);
			continue;
		}
		const result = validateDrafts(raw, avoid, ruleIds, remaining);
		rejected.push(...result.rejected);
		// One question per target: accept a draft only if it fulfills a target not yet
		// fulfilled this run, so accepted questions per run stay ≤ requested targets.
		const fulfilledIds = new Set<string>();
		for (const draft of result.valid) {
			const hits = remaining.filter((t) => draft.ruleRefs.some((ref) => fulfills(ref, t.id)));
			if (hits.every((t) => fulfilledIds.has(t.id))) {
				rejected.push(
					`draft ("${draft.prompt.slice(0, 40)}…"): target(s) already fulfilled this run`
				);
				continue;
			}
			for (const t of hits) fulfilledIds.add(t.id);
			accepted.push(draft);
		}
		remaining = remaining.filter((t) => !fulfilledIds.has(t.id));
	}
	return {
		questions: toQuestions(accepted, job),
		rejected,
		unfulfilled: remaining.map((t) => t.id)
	};
}
