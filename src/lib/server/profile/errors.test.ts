import { describe, expect, it } from 'vitest';
import { isUniqueConstraintError } from './errors';

describe('isUniqueConstraintError', () => {
	it('recognizes a SQLite unique-constraint violation', () => {
		const err = new Error('D1_ERROR: UNIQUE constraint failed: user.display_name');
		expect(isUniqueConstraintError(err)).toBe(true);
	});

	it('matches regardless of case', () => {
		expect(isUniqueConstraintError(new Error('unique constraint failed'))).toBe(true);
	});

	it('rejects unrelated database errors', () => {
		expect(isUniqueConstraintError(new Error('D1_ERROR: network timeout'))).toBe(false);
	});

	it('rejects non-errors', () => {
		expect(isUniqueConstraintError(null)).toBe(false);
		expect(isUniqueConstraintError('UNIQUE constraint failed')).toBe(false);
	});
});
