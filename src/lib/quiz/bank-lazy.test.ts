import { describe, expect, it } from 'vitest';
import { DEFAULT_RULESET_ID } from '$lib/content/config';
import { loadAllQuestions, loadSectionQuestions, sortQuestionPaths } from './bank-lazy';

describe('bank-lazy', () => {
	it('loads one section without loading the rest', async () => {
		const questions = await loadSectionQuestions(DEFAULT_RULESET_ID, '1');
		expect(questions.length).toBeGreaterThan(0);
		expect(questions.every((q) => q.sectionSlug === '1')).toBe(true);
	});

	it('resolves empty for an unknown section', async () => {
		expect(await loadSectionQuestions(DEFAULT_RULESET_ID, 'no-such-section')).toEqual([]);
	});

	it('loads the whole bank', async () => {
		const all = await loadAllQuestions(DEFAULT_RULESET_ID);
		expect(all.length).toBeGreaterThan(200);
		expect(all.every((q) => q.rulesetId === DEFAULT_RULESET_ID)).toBe(true);
	});

	it('orders the whole bank as the concatenation of sections in path-sorted order', async () => {
		// Derive today's section slugs from the same glob bank-lazy.ts reads, sorted the
		// same way, so this test doesn't need updating as sections are added or removed.
		const files = import.meta.glob('$content/questions/*/*.json');
		const slugs = Object.keys(files)
			.filter((p) => p.includes(`/questions/${DEFAULT_RULESET_ID}/`))
			.sort()
			.map((p) => p.slice(p.lastIndexOf('/') + 1).replace(/\.json$/, ''));
		expect(slugs.length).toBeGreaterThan(0);

		const expectedIds = (
			await Promise.all(slugs.map((slug) => loadSectionQuestions(DEFAULT_RULESET_ID, slug)))
		).flatMap((qs) => qs.map((q) => q.id));

		const actualIds = (await loadAllQuestions(DEFAULT_RULESET_ID)).map((q) => q.id);
		expect(actualIds).toEqual(expectedIds);
	});

	it('sorts an out-of-order path list', () => {
		// The test above can't tell a real sort from a no-op: `import.meta.glob`
		// already hands `loadAllQuestions` its paths pre-sorted, so the input is
		// sorted whether or not `sortQuestionPaths` does anything. This calls the
		// sort directly against input that isn't pre-sorted, so deleting its
		// `.sort()` shows up here instead of passing silently.
		const shuffled = [
			'/content/questions/r/9.json',
			'/content/questions/r/10.json',
			'/content/questions/r/2.json'
		];
		expect(sortQuestionPaths(shuffled)).toEqual([
			'/content/questions/r/10.json',
			'/content/questions/r/2.json',
			'/content/questions/r/9.json'
		]);
	});
});
