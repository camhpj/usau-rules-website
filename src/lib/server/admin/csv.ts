/** Serialize a header + rows to an RFC-4180 CSV string (CRLF line breaks). */
export function toCsv(headers: string[], rows: readonly (readonly unknown[])[]): string {
	const lines = [headers.map(escapeField).join(',')];
	for (const row of rows) lines.push(row.map(escapeField).join(','));
	return lines.join('\r\n');
}

function escapeField(value: unknown): string {
	if (value === null || value === undefined) return '';
	const s = String(value);
	return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
