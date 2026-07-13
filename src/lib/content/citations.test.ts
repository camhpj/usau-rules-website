import { describe, expect, it } from 'vitest';
import { segmentCitations } from './citations';

const ids = new Set(['15.A.3', '20.E.2.d', 'preface']);

describe('segmentCitations', () => {
	it('splits verified refs out of the text', () => {
		expect(segmentCitations('See [15.A.3] and [20.E.2.d].', ids)).toEqual([
			{ type: 'text', text: 'See ' },
			{ type: 'ref', id: '15.A.3', anchorId: '15.A.3' },
			{ type: 'text', text: ' and ' },
			{ type: 'ref', id: '20.E.2.d', anchorId: '20.E.2.d' },
			{ type: 'text', text: '.' }
		]);
	});
	it('leaves unverified ids as literal text — never a link', () => {
		expect(segmentCitations('Bogus [99.ZZ] here', ids)).toEqual([
			{ type: 'text', text: 'Bogus [99.ZZ] here' }
		]);
	});
	it('handles streaming prefixes: an unterminated bracket stays text (until the next chunk)', () => {
		expect(segmentCitations('Per [15.A', ids)).toEqual([{ type: 'text', text: 'Per [15.A' }]);
	});
	it('handles empty text and section anchors', () => {
		expect(segmentCitations('', ids)).toEqual([]);
		expect(segmentCitations('[preface]', ids)).toEqual([
			{ type: 'ref', id: 'preface', anchorId: 'preface' }
		]);
	});
	it('links an unknown lettered leaf id to its nearest known dotted ancestor', () => {
		const idsWithParent = new Set(['15.F.2', 'preface']);
		expect(segmentCitations('See [15.F.2.b].', idsWithParent)).toEqual([
			{ type: 'text', text: 'See ' },
			{ type: 'ref', id: '15.F.2.b', anchorId: '15.F.2' },
			{ type: 'text', text: '.' }
		]);
		expect(segmentCitations('Bogus [99.ZZ] here', idsWithParent)).toEqual([
			{ type: 'text', text: 'Bogus [99.ZZ] here' }
		]);
	});
});
