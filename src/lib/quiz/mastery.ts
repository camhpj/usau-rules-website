import { shuffle, type Rng } from './engine';
import type { Question } from './types';
import type { ResponseRecord } from './storage';

export type MasteryLevel = 'unseen' | 'learning' | 'solid' | 'mastered';

export interface SectionMastery {
	sectionSlug: string;
	attempts: number;
	recentPct: number;
	level: MasteryLevel;
}

export const MASTERY_WINDOW = 20;
export const MASTERY_MIN_ATTEMPTS = 10;

export function computeSectionMastery(
	responses: ResponseRecord[],
	sectionSlug: string
): SectionMastery {
	const recent = responses.filter((r) => r.sectionSlug === sectionSlug).slice(-MASTERY_WINDOW);
	if (recent.length === 0) return { sectionSlug, attempts: 0, recentPct: 0, level: 'unseen' };
	const recentPct = Math.round((100 * recent.filter((r) => r.correct).length) / recent.length);
	const level: MasteryLevel =
		recentPct >= 90 && recent.length >= MASTERY_MIN_ATTEMPTS
			? 'mastered'
			: recentPct >= 60
				? 'solid'
				: 'learning';
	return { sectionSlug, attempts: recent.length, recentPct, level };
}

/** Missed questions resurface first, then unseen, then previously-correct (stalest first). */
export function orderForMastery(
	questions: Question[],
	responses: ResponseRecord[],
	rng: Rng
): Question[] {
	const lastByQuestion = new Map<string, ResponseRecord>();
	for (const r of responses) lastByQuestion.set(r.questionId, r); // responses are chronological
	const missed: Question[] = [];
	const unseen: Question[] = [];
	const correct: Question[] = [];
	for (const question of questions) {
		const last = lastByQuestion.get(question.id);
		if (!last) unseen.push(question);
		else if (last.correct) correct.push(question);
		else missed.push(question);
	}
	correct.sort((a, b) => lastByQuestion.get(a.id)!.at - lastByQuestion.get(b.id)!.at);
	return [...shuffle(missed, rng), ...shuffle(unseen, rng), ...correct];
}
