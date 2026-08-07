import { describe, expect, it } from 'vitest';
import { allowTestSignIn } from './dev-signin';

describe('allowTestSignIn', () => {
	it('true when ALLOW_TEST_SIGNIN is exactly "1"', () => {
		expect(allowTestSignIn({ ALLOW_TEST_SIGNIN: '1' } as never)).toBe(true);
	});

	it('false when ALLOW_TEST_SIGNIN is unset', () => {
		expect(allowTestSignIn({} as never)).toBe(false);
	});

	it('false when ALLOW_TEST_SIGNIN is any other value (not just falsy)', () => {
		expect(allowTestSignIn({ ALLOW_TEST_SIGNIN: 'true' } as never)).toBe(false);
		expect(allowTestSignIn({ ALLOW_TEST_SIGNIN: '0' } as never)).toBe(false);
		expect(allowTestSignIn({ ALLOW_TEST_SIGNIN: 'yes' } as never)).toBe(false);
	});

	it('false when env itself is undefined (platform absent, e.g. mid-prerender)', () => {
		expect(allowTestSignIn(undefined)).toBe(false);
	});
});
