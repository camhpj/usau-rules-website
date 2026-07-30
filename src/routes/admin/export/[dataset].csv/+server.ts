import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/session';
import { csvLine } from '$lib/server/admin/csv';
import { DATASETS, type Cursor } from '$lib/server/admin/datasets';

// Rows fetched per keyset page. Low thousands: few enough D1 round trips to export a large
// table, small enough that one page never holds more than a moment's worth of memory.
const CHUNK_SIZE = 2000;

export const GET: RequestHandler = async (event) => {
	await requireAdmin(event); // defense in depth: not under the page layout
	const def = DATASETS[event.params.dataset];
	if (!def) error(404, 'Not found');

	const db = event.locals.db;
	const encoder = new TextEncoder();
	// Cursor lives in this closure, not in a loop inside start(): a loop that keeps calling
	// enqueue() never yields to backpressure, since enqueue() doesn't block on Workers — the
	// queue would grow toward the whole file in memory while a slow client drains it over the
	// network. Fetching and enqueueing exactly one page per pull() call instead means the
	// runtime only asks for the next page once the current one has been read out, bounding
	// memory at roughly one chunk regardless of how fast D1 responds or how slow the client is.
	let cursor: Cursor | null = null;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(encoder.encode(csvLine(def.columns) + '\r\n'));
		},
		async pull(controller) {
			const page = await def.rows(db, cursor, CHUNK_SIZE);
			for (const row of page.rows) controller.enqueue(encoder.encode(csvLine(row) + '\r\n'));
			cursor = page.next;
			if (cursor === null) controller.close();
			// An error thrown above (e.g. a D1 failure mid-export) rejects this call's promise;
			// ReadableStream errors the stream for the reader automatically in that case, so the
			// download fails visibly instead of silently truncating.
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="${event.params.dataset}.csv"`
		}
	});
};
