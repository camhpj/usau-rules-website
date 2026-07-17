import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

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
});
