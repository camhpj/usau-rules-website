import type { PageServerLoad } from './$types';
import { DEFAULT_RULESET_ID } from '$lib/content/config';
import { listQuestions, questionCountsBySection } from '$lib/server/quiz/bank';

// Runs at build time: this route prerenders, so the counts are baked into the
// prerendered payload and the question bank never reaches the browser.
//
// Setup needs match counts before any question loads, so the server sends the
// breakdown rather than the questions themselves.
export const load: PageServerLoad = () => {
	const bySectionDifficulty: Record<string, Record<number, number>> = {};
	for (const q of listQuestions(DEFAULT_RULESET_ID)) {
		(bySectionDifficulty[q.sectionSlug] ??= {})[q.difficulty] =
			(bySectionDifficulty[q.sectionSlug][q.difficulty] ?? 0) + 1;
	}
	return {
		questionTotal: listQuestions(DEFAULT_RULESET_ID).length,
		counts: Object.fromEntries(questionCountsBySection(DEFAULT_RULESET_ID)),
		bySectionDifficulty
	};
};
