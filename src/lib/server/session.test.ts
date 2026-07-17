import { describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { parseAdminEmails, requireAdmin } from './session';

describe('parseAdminEmails', () => {
	it('splits, trims, lowercases, drops empties', () => {
		const set = parseAdminEmails(' A@x.com , b@Y.com ,, ');
		expect([...set].sort()).toEqual(['a@x.com', 'b@y.com']);
	});
	it('empty / null / undefined → empty set (deny all)', () => {
		expect(parseAdminEmails('').size).toBe(0);
		expect(parseAdminEmails(null).size).toBe(0);
		expect(parseAdminEmails(undefined).size).toBe(0);
	});
});

function fakeEvent(opts: {
	auth?: boolean;
	session?: { user: { id: string; email: string } } | null;
	adminEmails?: string;
}): RequestEvent {
	return {
		locals: {
			auth: opts.auth === false ? undefined : { api: { getSession: async () => opts.session ?? null } }
		},
		request: { headers: new Headers() },
		platform: { env: { ADMIN_EMAILS: opts.adminEmails } }
	} as unknown as RequestEvent;
}

describe('requireAdmin', () => {
	it('returns the user when email is allowlisted (case-insensitive)', async () => {
		const ev = fakeEvent({
			session: { user: { id: 'u1', email: 'Boss@Site.com' } },
			adminEmails: 'boss@site.com'
		});
		const user = await requireAdmin(ev);
		expect(user.id).toBe('u1');
	});
	it('404 when signed in but not allowlisted', async () => {
		const ev = fakeEvent({ session: { user: { id: 'u2', email: 'x@x.com' } }, adminEmails: 'boss@site.com' });
		await expect(requireAdmin(ev)).rejects.toMatchObject({ status: 404 });
	});
	it('404 when signed out', async () => {
		const ev = fakeEvent({ session: null, adminEmails: 'boss@site.com' });
		await expect(requireAdmin(ev)).rejects.toMatchObject({ status: 404 });
	});
	it('404 when ADMIN_EMAILS is unset (fail closed)', async () => {
		const ev = fakeEvent({ session: { user: { id: 'u3', email: 'boss@site.com' } } });
		await expect(requireAdmin(ev)).rejects.toMatchObject({ status: 404 });
	});
	it('404 when auth binding is missing', async () => {
		const ev = fakeEvent({ auth: false, adminEmails: 'boss@site.com' });
		await expect(requireAdmin(ev)).rejects.toMatchObject({ status: 404 });
	});
});
