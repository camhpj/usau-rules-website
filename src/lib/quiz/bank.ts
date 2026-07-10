import { z } from 'zod';
import { QuestionSchema, type Question } from './types';

const files = import.meta.glob('$content/questions/*/*.json', {
	eager: true
}) as Record<string, { default: unknown }>;

const all: Question[] = Object.entries(files)
	.sort(([a], [b]) => a.localeCompare(b))
	.flatMap(([, mod]) => z.array(QuestionSchema).parse(mod.default));

export function listQuestions(rulesetId: string): Question[] {
	return all.filter((q) => q.rulesetId === rulesetId);
}

export function questionCountsBySection(rulesetId: string): Map<string, number> {
	const counts = new Map<string, number>();
	for (const q of listQuestions(rulesetId)) {
		counts.set(q.sectionSlug, (counts.get(q.sectionSlug) ?? 0) + 1);
	}
	return counts;
}
