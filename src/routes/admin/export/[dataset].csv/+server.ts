import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/session';
import { toCsv } from '$lib/server/admin/csv';
import { DATASETS, EXPORT_MAX_ROWS } from '$lib/server/admin/datasets';

export const GET: RequestHandler = async (event) => {
	await requireAdmin(event); // defense in depth: not under the page layout
	const def = DATASETS[event.params.dataset];
	if (!def) error(404, 'Not found');

	const rows = await def.rows(event.locals.db, EXPORT_MAX_ROWS);
	const body = toCsv(def.columns, rows);
	return new Response(body, {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="${event.params.dataset}-${rows.length}.csv"`
		}
	});
};
