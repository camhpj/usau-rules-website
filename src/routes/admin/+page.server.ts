import type { PageServerLoad } from './$types';
import { loadDashboardMetrics } from '$lib/server/admin/metrics';
import { requireDb } from '$lib/server/http';

const ALLOWED_RANGES = [7, 14, 30, 90];
const DEFAULT_RANGE = 14;

export const load: PageServerLoad = async (event) => {
	await event.parent();
	const db = requireDb(event.locals);
	const raw = Number(event.url.searchParams.get('range'));
	const rangeDays = ALLOWED_RANGES.includes(raw) ? raw : DEFAULT_RANGE;
	const metrics = await loadDashboardMetrics(db, Date.now(), rangeDays);
	return { metrics };
};
