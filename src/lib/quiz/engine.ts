import type { Question } from './types';

export type Rng = () => number;

/** Deterministic PRNG so shuffles are testable and replayable. */
export function mulberry32(seed: number): Rng {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

export interface QuestionFilter {
	sections?: string[];
	difficulties?: number[];
}

export function filterQuestions(bank: Question[], filter: QuestionFilter): Question[] {
	return bank.filter(
		(q) =>
			(!filter.sections?.length || filter.sections.includes(q.sectionSlug)) &&
			(!filter.difficulties?.length || filter.difficulties.includes(q.difficulty))
	);
}

/** A question prepared for one run: choice display order is shuffled. */
export interface QuizItem {
	question: Question;
	/** display position -> index into question.choices */
	order: number[];
	/** display position of the correct choice */
	correctChoice: number;
}

export function buildQuizItems(questions: Question[], rng: Rng): QuizItem[] {
	return questions.map((question) => {
		const order = shuffle(
			question.choices.map((_, i) => i),
			rng
		);
		return { question, order, correctChoice: order.indexOf(question.answerIndex) };
	});
}

export interface AnswerRecord {
	questionId: string;
	sectionSlug: string;
	chosenChoice: number;
	correct: boolean;
}

export interface QuizScore {
	total: number;
	correct: number;
	pct: number;
}

export function summarize(records: AnswerRecord[]): QuizScore {
	const correct = records.filter((r) => r.correct).length;
	return {
		total: records.length,
		correct,
		pct: records.length ? Math.round((100 * correct) / records.length) : 0
	};
}
