import type { LayoutServerLoad } from './$types';
import { requireAdmin } from '$lib/server/session';

export const prerender = false;

export const load: LayoutServerLoad = async (event) => {
	await requireAdmin(event);
	return {};
};
