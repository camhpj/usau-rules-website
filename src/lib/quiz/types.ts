import { z } from 'zod';

export interface Question {
	id: string; // unique within a ruleset, "<sectionSlug>-<nn>"
	rulesetId: string;
	type: 'multiple-choice';
	prompt: string;
	choices: string[]; // exactly 4
	answerIndex: number; // 0..3
	explanation: string;
	ruleRefs: string[]; // rule ids grounding the answer
	sectionSlug: string;
	difficulty: 1 | 2 | 3;
}

export const QuestionSchema: z.ZodType<Question> = z.object({
	id: z.string().min(1),
	rulesetId: z.string().min(1),
	type: z.literal('multiple-choice'),
	prompt: z.string().min(10),
	choices: z.array(z.string().min(1)).length(4),
	answerIndex: z.number().int().min(0).max(3),
	explanation: z.string().min(10),
	ruleRefs: z.array(z.string().min(1)).min(1),
	sectionSlug: z.string().min(1),
	difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)])
});

export const DIFFICULTY_LABELS: Record<1 | 2 | 3, string> = {
	1: 'Rookie',
	2: 'Veteran',
	3: 'Observer'
};
