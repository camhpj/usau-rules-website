import { z } from 'zod';

/**
 * Stateless anti-cheat handshake for timed runs: the server signs
 * {userId, runId, startedAt, rulesetId} at run start and only accepts
 * results whose token verifies, whose elapsed time fits the run window,
 * and whose rulesetId matches the finish payload's ruleset. Replay is
 * blocked by quiz_attempts.client_id = "timed:<runId>" (unique).
 */

export interface RunClaims {
	userId: string;
	runId: string;
	startedAt: number;
	rulesetId: string;
}

const ClaimsSchema: z.ZodType<RunClaims> = z.object({
	userId: z.string().min(1),
	runId: z.string().min(1),
	startedAt: z.number().int().positive(),
	rulesetId: z.string().min(1)
});

const encoder = new TextEncoder();

function hmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		[usage]
	);
}

function toHex(buf: ArrayBuffer): string {
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
	if (hex.length % 2 !== 0 || /[^0-9a-f]/.test(hex)) return null;
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return bytes;
}

export async function mintRunToken(claims: RunClaims, secret: string): Promise<string> {
	const payload = btoa(JSON.stringify(claims));
	const key = await hmacKey(secret, 'sign');
	const sig = toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
	return `${payload}.${sig}`;
}

export async function verifyRunToken(token: string, secret: string): Promise<RunClaims | null> {
	const dot = token.indexOf('.');
	if (dot === -1) return null;
	const payload = token.slice(0, dot);
	const sigBytes = fromHex(token.slice(dot + 1));
	if (!sigBytes) return null;
	const key = await hmacKey(secret, 'verify');
	let valid = false;
	try {
		valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(payload));
	} catch {
		return null;
	}
	if (!valid) return null;
	try {
		return ClaimsSchema.parse(JSON.parse(atob(payload)));
	} catch {
		return null;
	}
}
