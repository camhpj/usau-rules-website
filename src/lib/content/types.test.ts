import { describe, expect, it } from 'vitest';
import { ManifestSchema, RuleNodeSchema, SectionSchema, GlossaryEntrySchema } from './types';

const rule = {
	id: '2.D.1',
	label: '2.D.1.',
	html: 'know and abide by the rules;',
	text: 'know and abide by the rules;',
	annotations: [],
	refs: [],
	children: []
};

describe('content schemas', () => {
	it('accepts a valid nested rule node', () => {
		const parent = { ...rule, id: '2.D', label: '2.D.', children: [rule] };
		expect(RuleNodeSchema.parse(parent).children).toHaveLength(1);
	});

	it('accepts a header-only rule with empty html and text', () => {
		const headerOnly = { ...rule, html: '', text: '' };
		expect(RuleNodeSchema.parse(headerOnly).text).toBe('');
	});

	it('rejects a rule without an id', () => {
		expect(() => RuleNodeSchema.parse({ ...rule, id: '' })).toThrow();
	});

	it('accepts a valid section and manifest', () => {
		const section = {
			slug: '2',
			anchorId: '2',
			number: '2',
			kind: 'section',
			title: 'Spirit of the Game',
			html: null,
			rules: [rule]
		};
		expect(SectionSchema.parse(section).kind).toBe('section');
		const manifest = {
			id: 'usau-official-2026-27',
			title: 'Official Rules of Ultimate',
			shortTitle: 'Official Rules',
			edition: '2026-2027',
			sourceUrl: 'https://usaultimate.org/rules/',
			sectionScheme: 'numeric',
			fetchedAt: '2026-07-09T00:00:00.000Z',
			sections: [
				{ slug: '2', number: '2', kind: 'section', title: 'Spirit of the Game', ruleCount: 5 }
			]
		};
		expect(ManifestSchema.parse(manifest).sections[0].ruleCount).toBe(5);
	});

	it('rejects a bad section kind and a bad glossary entry', () => {
		expect(() =>
			SectionSchema.parse({
				slug: 'x',
				anchorId: 'x',
				number: null,
				kind: 'chapter',
				title: 'X',
				html: null,
				rules: []
			})
		).toThrow();
		expect(() => GlossaryEntrySchema.parse({ ruleId: '3.A', term: '', definition: 'd' })).toThrow();
	});
});
