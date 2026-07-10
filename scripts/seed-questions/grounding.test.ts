import { describe, expect, it } from 'vitest';
import { sliceGrounding } from './grounding';

const grounding = `Official Rules of Ultimate (2026-2027)
Source: https://usaultimate.org/rules/
## Preface
Ultimate is a sport.
## 1. Introduction
[1.A] Description text.
[1.B] Variations text.
## 2. Spirit of the Game
[2.A] Spirit text.`;

describe('sliceGrounding', () => {
	it('extracts one section block', () => {
		const slice = sliceGrounding(grounding, '1', 'Introduction');
		expect(slice).toContain('## 1. Introduction');
		expect(slice).toContain('[1.B]');
		expect(slice).not.toContain('Spirit text');
	});
	it('extracts the final section to end of file', () => {
		expect(sliceGrounding(grounding, '2', 'Spirit of the Game')).toContain('[2.A]');
	});
	it('throws when the section is missing', () => {
		expect(() => sliceGrounding(grounding, '3', 'Definitions')).toThrow(/not found/);
	});
});
