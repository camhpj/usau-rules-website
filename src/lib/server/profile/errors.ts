/**
 * True when a rejected write was the unique index refusing a duplicate, as opposed
 * to a transient failure. D1 surfaces SQLite's message verbatim, so matching the
 * text is the only signal available.
 */
export function isUniqueConstraintError(err: unknown): boolean {
	return err instanceof Error && /unique constraint failed/i.test(err.message);
}
