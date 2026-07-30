import { describe, expect, it } from 'vitest';
import { csvLine, toCsv } from './csv';

describe('toCsv', () => {
	it('writes header + rows', () => {
		expect(
			toCsv(
				['a', 'b'],
				[
					[1, 2],
					[3, 4]
				]
			)
		).toBe('a,b\r\n1,2\r\n3,4');
	});
	it('escapes quotes, commas, and newlines', () => {
		expect(toCsv(['x'], [['he said "hi"'], ['a,b'], ['line\nbreak']])).toBe(
			'x\r\n"he said ""hi"""\r\n"a,b"\r\n"line\nbreak"'
		);
	});
	it('null/undefined → empty field', () => {
		expect(toCsv(['a', 'b'], [[null, undefined]])).toBe('a,b\r\n,');
	});
	it('header only when no rows', () => {
		expect(toCsv(['a', 'b'], [])).toBe('a,b');
	});
	it('neutralizes leading spreadsheet-formula characters', () => {
		expect(toCsv(['x'], [['=1+1'], ['+x'], ['-x'], ['@x']])).toBe(
			"x\r\n'=1+1\r\n'+x\r\n'-x\r\n'@x"
		);
	});
});

describe('csvLine (streaming assembly)', () => {
	it('composes to the same output as toCsv when called once per row', () => {
		const headers = ['a', 'b'];
		const rows = [
			[1, 2],
			[3, 4],
			['he said "hi"', 'a,b']
		];
		const streamed = [csvLine(headers), ...rows.map(csvLine)].join('\r\n');
		expect(streamed).toBe(toCsv(headers, rows));
	});

	it('a multi-chunk dataset emits the header exactly once and every row exactly once, in order', () => {
		const headers = ['id', 'value'];
		// Simulates three keyset pages plus an empty page (the shape a "no more rows" read
		// could take), the way the streaming export route calls this per fetched page.
		const chunks: (readonly unknown[])[][] = [
			[
				[1, 'a'],
				[2, 'b']
			],
			[[3, 'c']],
			[],
			[
				[4, 'd'],
				[5, 'e']
			]
		];

		const lines = [csvLine(headers)];
		for (const chunk of chunks) for (const row of chunk) lines.push(csvLine(row));

		// Header appears exactly once, at the start, regardless of how many chunks follow.
		expect(lines.filter((l) => l === 'id,value')).toHaveLength(1);
		expect(lines[0]).toBe('id,value');
		// Every row appears exactly once, in the same order the chunks were produced.
		expect(lines).toEqual(['id,value', '1,a', '2,b', '3,c', '4,d', '5,e']);
		// Equivalent to a single non-chunked call: chunk boundaries change nothing.
		expect(lines.join('\r\n')).toBe(toCsv(headers, chunks.flat()));
	});
});
