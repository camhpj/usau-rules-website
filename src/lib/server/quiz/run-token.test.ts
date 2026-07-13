import { describe, expect, it } from 'vitest';
import { mintRunToken, verifyRunToken } from './run-token';

const claims = { userId: 'u1', runId: 'r1', startedAt: 1752100000000, rulesetId: 'rs-a' };

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
	it('round-trips rulesetId in the claims', async () => {
		const token = await mintRunToken(
			{ userId: 'u1', runId: 'r1', startedAt: 123, rulesetId: 'rs-a' },
			'secret'
		);
		const claims = await verifyRunToken(token, 'secret');
		expect(claims).toMatchObject({ rulesetId: 'rs-a' });
	});
	it('rejects legacy tokens without rulesetId', async () => {
		// Sign a pre-upgrade claims shape (no rulesetId) with a VALID signature so
		// rejection can only come from the claims schema, not the HMAC check.
		const payload = btoa(JSON.stringify({ userId: 'u1', runId: 'r1', startedAt: 123 }));
		const key = await crypto.subtle.importKey(
			'raw',
			new TextEncoder().encode('secret'),
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign']
		);
		const sig = [
			...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)))
		]
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
		expect(await verifyRunToken(`${payload}.${sig}`, 'secret')).toBeNull();
	});
});
