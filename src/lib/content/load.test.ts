import { describe, expect, it } from 'vitest';
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
	it('loads a section with rules', () => {
		const s = getSection('usau-official-2026-27', '2');
		expect(s.title).toBe('Spirit of the Game');
		expect(s.rules.length).toBeGreaterThan(3);
	});
	it('loads glossary including Best perspective', () => {
		const terms = getGlossary('usau-official-2026-27').map((g) => g.term.toLowerCase());
		expect(terms).toContain('best perspective');
	});
	it('throws on unknown ids', () => {
		expect(() => getManifest('nope')).toThrow();
		expect(() => getSection('usau-official-2026-27', '99')).toThrow();
	});
});
