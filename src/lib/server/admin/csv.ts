/** Serialize a header + rows to an RFC-4180 CSV string (CRLF line breaks). */
export function toCsv(headers: string[], rows: readonly (readonly unknown[])[]): string {
	return [csvLine(headers), ...rows.map(csvLine)].join('\r\n');
}

/**
 * Serialize one row (or the header) to a single CSV line, with no line terminator. `toCsv`
 * calls this once per row, so a streamed export that calls it directly — one row at a time,
 * across however many chunks a paged read produces — escapes identically to the buffered path.
 */
export function csvLine(fields: readonly unknown[]): string {
	return fields.map(escapeField).join(',');
}

function escapeField(value: unknown): string {
	if (value === null || value === undefined) return '';
	let s = String(value);
	// Neutralize spreadsheet formula injection: a leading =, +, -, @, tab, or CR
	// can execute as a formula in Excel/Sheets. Prefix a single quote to defuse it.
	if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
	return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
