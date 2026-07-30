import type { PageServerLoad } from './$types';
import { DEFAULT_RULESET_ID } from '$lib/content/config';
import { listQuestions, questionCountsBySection } from '$lib/server/quiz/bank';

// Runs at build time: this route prerenders, so the counts are baked into the
// prerendered payload and the question bank never reaches the browser.
export const load: PageServerLoad = () => ({
	questionTotal: listQuestions(DEFAULT_RULESET_ID).length,
	counts: Object.fromEntries(questionCountsBySection(DEFAULT_RULESET_ID))
});
