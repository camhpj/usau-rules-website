import { describe, expect, it } from 'vitest';
import { resolveUniqueName, suggestDisplayName, validateDisplayName } from './display-name';

describe('validateDisplayName', () => {
	it('accepts and trims a normal name', () => {
		expect(validateDisplayName('  Cameron J.  ')).toEqual({ ok: true, name: 'Cameron J.' });
		expect(validateDisplayName("O'Neil-Smith 7")).toEqual({ ok: true, name: "O'Neil-Smith 7" });
	});
	it('rejects too short, too long, and bad charset', () => {
		expect(validateDisplayName('C')).toMatchObject({ ok: false });
		expect(validateDisplayName('x'.repeat(31))).toMatchObject({ ok: false });
		expect(validateDisplayName('nope<script>')).toMatchObject({ ok: false });
		expect(validateDisplayName('emoji 🥏')).toMatchObject({ ok: false });
	});
	it('rejects profanity, including obfuscated variants', () => {
		expect(validateDisplayName('fuck')).toMatchObject({ ok: false });
		expect(validateDisplayName('FuuuCk this')).toMatchObject({ ok: false });
	});
});

describe('suggestDisplayName', () => {
	it('derives First L. from a two-part name', () => {
		expect(suggestDisplayName('Cameron Johnson')).toBe('Cameron J.');
		expect(suggestDisplayName('Ana Maria de Silva')).toBe('Ana S.');
	});
	it('falls back sensibly for single names and empties', () => {
		expect(suggestDisplayName('Cher')).toBe('Cher');
		expect(suggestDisplayName('  ')).toBe('Player');
	});
});

describe('resolveUniqueName', () => {
	const takenSet = (names: string[]) => async (c: string) =>
		names.some((n) => n.toLowerCase() === c.toLowerCase());
	it('returns the base when free', async () => {
		expect(await resolveUniqueName('Cameron J.', takenSet([]))).toBe('Cameron J.');
	});
	it('appends the first free numeric suffix, case-insensitively', async () => {
		expect(await resolveUniqueName('Cameron J.', takenSet(['cameron j.']))).toBe('Cameron J. 2');
		expect(await resolveUniqueName('Cameron J.', takenSet(['Cameron J.', 'Cameron J. 2']))).toBe(
			'Cameron J. 3'
		);
	});
	it('gives up after the cap', async () => {
		expect(await resolveUniqueName('X Y', async () => true)).toBeNull();
	});
});
