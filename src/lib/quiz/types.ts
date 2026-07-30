import { z } from 'zod';

export const QuestionSchema = z.object({
	// unique within a ruleset, "<sectionSlug>-<nn>"
	id: z.string().min(1),
	rulesetId: z.string().min(1),
	type: z.literal('multiple-choice'),
	prompt: z.string().min(10),
	// exactly 4
	choices: z.array(z.string().min(1)).length(4),
	// 0..3
	answerIndex: z.number().int().min(0).max(3),
	explanation: z.string().min(10),
	// rule ids grounding the answer
	ruleRefs: z.array(z.string().min(1)).min(1),
	sectionSlug: z.string().min(1),
	difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)])
});
export type Question = z.infer<typeof QuestionSchema>;

export const DIFFICULTY_LABELS: Record<1 | 2 | 3, string> = {
	1: 'Rookie',
	2: 'Veteran',
	3: 'Observer'
};
