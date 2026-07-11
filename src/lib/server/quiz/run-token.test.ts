import { describe, expect, it } from 'vitest';
import { mintRunToken, verifyRunToken } from './run-token';

const claims = { userId: 'u1', runId: 'r1', startedAt: 1752100000000 };

describe('run tokens', () => {
	it('round-trips valid claims', async () => {
		const token = await mintRunToken(claims, 'secret-a');
		expect(await verifyRunToken(token, 'secret-a')).toEqual(claims);
	});
	it('rejects a tampered payload', async () => {
		const token = await mintRunToken(claims, 'secret-a');
		const [payload, sig] = token.split('.');
		const forged = btoa(JSON.stringify({ ...claims, startedAt: 9999999999999 }));
		expect(await verifyRunToken(`${forged}.${sig}`, 'secret-a')).toBeNull();
		expect(await verifyRunToken(`${payload}.${'0'.repeat(sig.length)}`, 'secret-a')).toBeNull();
	});
	it('rejects the wrong secret and malformed tokens', async () => {
		const token = await mintRunToken(claims, 'secret-a');
		expect(await verifyRunToken(token, 'secret-b')).toBeNull();
		expect(await verifyRunToken('garbage', 'secret-a')).toBeNull();
		expect(await verifyRunToken('not-base64!.deadbeef', 'secret-a')).toBeNull();
	});
});
