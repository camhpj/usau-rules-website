import { z } from 'zod';
import { nearestKnownRuleId, sectionSlugForRuleId } from '$lib/content/rule-ids';
import type { Question } from '$lib/quiz/types';

export interface ScenarioDraft {
	prompt: string;
	choices: string[];
	answerIndex: number;
	explanation: string;
	ruleRefs: string[];
	difficulty: 1 | 2 | 3;
}

export const ScenarioDraftSchema: z.ZodType<ScenarioDraft> = z.object({
	prompt: z.string().min(40),
	choices: z.array(z.string().min(1)).length(4),
	answerIndex: z.number().int().min(0).max(3),
	explanation: z.string().min(10),
	ruleRefs: z.array(z.string().min(1)).min(1),
	difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)])
});

// Real rule ids (20.E.2.d force-out foul, 13.A.2 end-zone possession) so the
// example teaches verbatim citation without teaching a fictional id.
const EXAMPLE_SCENARIO: ScenarioDraft = {
	prompt:
		'Late in a windy game, Dana hucks to the end zone. Kai skies two defenders and catches the disc cleanly, but defender Morgan — still airborne from the same jump — collides with Kai, and the contact causes Kai to land beyond the backline. Morgan announces a turnover; Kai calls a force-out foul, and Morgan does not contest. What is the correct outcome?',
	choices: [
		'Goal — an uncontested force-out foul on a receiver who would have landed in the end zone awards the score.',
		'Turnover — where a receiver first lands always determines possession, regardless of contact.',
		'Kai keeps possession at the spot of the catch, but no goal is awarded.',
		'The disc returns to Dana and the pass is replayed.'
	],
	answerIndex: 0,
	explanation:
		'Under 20.E.2.d, contact that causes an airborne receiver to land out of the end zone instead of in it is a force-out foul; uncontested, the goal stands (see also 13.A.2).',
	ruleRefs: ['20.E.2.d', '13.A.2'],
	difficulty: 2
};

export function buildScenarioPrompt(difficulty?: 1 | 2 | 3, avoidPrompts: string[] = []): string {
	const avoid = avoidPrompts.map((p) => `- ${p}`).join('\n');
	return `Generate ONE scenario-style multiple-choice question for a study tool covering the USA Ultimate Official Rules of Ultimate, using ONLY the rulebook provided earlier in this conversation as your source of truth.

Write a vivid, realistic in-game vignette (2–4 sentences, named players, one concrete situation), then ask for the correct ruling.

Requirements:
- "prompt": the vignette plus the question, fully self-contained.
- "choices": exactly 4 distinct options. Exactly one is correct per the rule text; the other three are plausible but wrong (common misconceptions, near-miss numbers, adjacent rules). Never "all of the above" or "none of the above".
- "answerIndex": 0-based index of the correct choice.
- "explanation": 1–3 sentences naming the rule ids that decide the ruling.
- "ruleRefs": the exact rule ids grounding the answer, as bare ids WITHOUT brackets (e.g. "20.E.2.d", not "[20.E.2.d]"). Every id MUST appear verbatim inside square brackets in the rulebook — do not cite document-style sub-references (e.g. "15.F.1.c") that never appear bracketed.
- "difficulty": ${difficulty ? `exactly ${difficulty}` : '1, 2, or 3 (1 = new players, 2 = club players, 3 = rules experts)'}.
${avoid ? `\nDo NOT duplicate or closely paraphrase any of these existing scenarios:\n${avoid}\n` : ''}
Return ONLY a single JSON object shaped exactly like this example:
${JSON.stringify(EXAMPLE_SCENARIO, null, 2)}`;
}

export function validateScenario(
	raw: unknown,
	ruleIds: ReadonlySet<string>
): { ok: true; draft: ScenarioDraft } | { ok: false; reason: string } {
	const candidate = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
	const parsed = ScenarioDraftSchema.safeParse(candidate);
	if (!parsed.success) {
		return { ok: false, reason: parsed.error.issues[0]?.message ?? 'schema error' };
	}
	const draft = parsed.data;
	const normalizedRefs: string[] = [];
	for (const ref of draft.ruleRefs) {
		const normalized = normalizeRuleRef(ref, ruleIds);
		if (normalized === null) return { ok: false, reason: `unknown ruleRef ${ref}` };
		if (!normalizedRefs.includes(normalized)) normalizedRefs.push(normalized);
	}
	if (new Set(draft.choices).size !== draft.choices.length) {
		return { ok: false, reason: 'duplicate choices' };
	}
	return { ok: true, draft: { ...draft, ruleRefs: normalizedRefs } };
}

/**
 * Normalizes a model-supplied rule ref against the known rule id set: trims
 * whitespace, strips one pair of surrounding square brackets, and — if the
 * bare id isn't a known rule — walks up dotted ancestors (`15.F.1.c` →
 * `15.F.1` → `15.F`) via the shared `nearestKnownRuleId` helper, substituting
 * the nearest known one. Returns null if neither the id nor any ancestor is
 * known.
 */
function normalizeRuleRef(ref: string, ruleIds: ReadonlySet<string>): string | null {
	let bare = ref.trim();
	const bracketed = bare.match(/^\[(.+)\]$/);
	if (bracketed) bare = bracketed[1].trim();
	return nearestKnownRuleId(bare, ruleIds);
}

export function draftToQuestion(draft: ScenarioDraft, rulesetId: string): Question {
	return {
		id: `ai-${crypto.randomUUID()}`,
		rulesetId,
		type: 'multiple-choice',
		sectionSlug: sectionSlugForRuleId(draft.ruleRefs[0]) ?? 'unknown',
		...draft
	};
}
