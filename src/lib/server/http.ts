import { error } from '@sveltejs/kit';
import type { z } from 'zod';

/**
 * Parse and validate a JSON request body, or throw a 400.
 *
 * Malformed JSON and schema failures are deliberately not distinguished: the
 * client cannot act differently on the two, and the distinction leaks shape
 * information about the endpoint.
 */
export async function parseJsonBody<T>(
	request: Request,
	schema: z.ZodType<T>,
	message = 'invalid request body'
): Promise<T> {
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		throw error(400, message);
	}
	const parsed = schema.safeParse(raw);
	if (!parsed.success) throw error(400, message);
	return parsed.data;
}
