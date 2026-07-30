import { describe, expect, it } from 'vitest';
import { DEFAULT_RULESET_ID } from './config';
import { getGlossary, getManifest, getSection, listRulesets } from './load';

describe('content loader (against real committed content)', () => {
	it('lists the official ruleset', () => {
		expect(listRulesets().map((m) => m.id)).toContain('usau-official-2026-27');
	});
	it('loads manifest with 31 ordered sections', () => {
		const m = getManifest('usau-official-2026-27');
		expect(m.sections).toHaveLength(31);
		expect(m.sections[0].slug).toBe('preface');
	});
	it('loads a section with rules', async () => {
		const s = await getSection('usau-official-2026-27', '2');
		expect(s.title).toBe('Spirit of the Game');
		expect(s.rules.length).toBeGreaterThan(3);
	});
	it('loads glossary including Best perspective', async () => {
		const terms = (await getGlossary('usau-official-2026-27')).map((g) => g.term.toLowerCase());
		expect(terms).toContain('best perspective');
	});
	it('throws on unknown ids', async () => {
		expect(() => getManifest('nope')).toThrow();
		await expect(getSection('usau-official-2026-27', '99')).rejects.toThrow();
	});
	it('rejects for an unknown section', async () => {
		await expect(getSection(DEFAULT_RULESET_ID, 'no-such-section')).rejects.toThrow();
	});
});
