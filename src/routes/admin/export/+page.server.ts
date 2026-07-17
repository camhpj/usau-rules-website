import type { PageServerLoad } from './$types';
import { DATASETS, EXPORT_MAX_ROWS } from '$lib/server/admin/datasets';

export const load: PageServerLoad = async (event) => {
	await event.parent();
	const db = event.locals.db;
	const datasets = await Promise.all(
		Object.entries(DATASETS).map(async ([slug, def]) => ({
			slug,
			label: def.label,
			count: await def.count(db)
		}))
	);
	return { datasets, max: EXPORT_MAX_ROWS };
};
