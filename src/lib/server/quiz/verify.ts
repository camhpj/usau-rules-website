import { listQuestions } from '$lib/quiz/bank';
import type { Question } from '$lib/quiz/types';

/** Server-authoritative scoring: the client's idea of "correct" is never persisted. */

const bankCache = new Map<string, Map<string, Question>>();

export function bankById(rulesetId: string): Map<string, Question> {
	let byId = bankCache.get(rulesetId);
	if (!byId) {
		byId = new Map(listQuestions(rulesetId).map((q) => [q.id, q]));
		bankCache.set(rulesetId, byId);
	}
	return byId;
}

export interface VerifiedResponse {
	questionId: string;
	sectionSlug: string;
	choiceIndex: number;
	correct: boolean;
	at: number;
}

export interface ResponseInput {
	questionId: string;
	choiceIndex: number;
	at?: number;
}

export function verifyResponses(
	inputs: ResponseInput[],
	bank: Map<string, Question>,
	now = Date.now()
): { ok: true; verified: VerifiedResponse[] } | { ok: false; reason: string } {
	const seen = new Set<string>();
	const verified: VerifiedResponse[] = [];
	for (const input of inputs) {
		const question = bank.get(input.questionId);
		if (!question) return { ok: false, reason: `unknown question ${input.questionId}` };
		if (seen.has(input.questionId)) {
			return { ok: false, reason: `duplicate question ${input.questionId}` };
		}
		seen.add(input.questionId);
		verified.push({
			questionId: question.id,
			sectionSlug: question.sectionSlug,
			choiceIndex: input.choiceIndex,
			correct: input.choiceIndex === question.answerIndex,
			at: input.at ?? now
		});
	}
	return { ok: true, verified };
}

export function recomputeTimed(verified: VerifiedResponse[]): {
	score: number;
	bestStreak: number;
} {
	let score = 0;
	let streak = 0;
	let bestStreak = 0;
	for (const response of verified) {
		if (response.correct) {
			score++;
			streak++;
			bestStreak = Math.max(bestStreak, streak);
		} else {
			streak = 0;
		}
	}
	return { score, bestStreak };
}
