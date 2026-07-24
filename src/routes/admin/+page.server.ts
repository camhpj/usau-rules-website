import type { PageServerLoad } from './$types';
import { loadDashboardMetrics } from '$lib/server/admin/metrics';

export const load: PageServerLoad = async (event) => {
	await event.parent();
	const metrics = await loadDashboardMetrics(event.locals.db, Date.now());
	return { metrics };
};
