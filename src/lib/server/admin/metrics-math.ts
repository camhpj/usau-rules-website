/** part/whole, guarding divide-by-zero. */
export function ratio(part: number, whole: number): number {
	return whole === 0 ? 0 : part / whole;
}

/** UTC YYYY-MM-DD for an epoch-ms timestamp. */
export function utcDay(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

/** `days` buckets ending at today (UTC), oldest first, missing days zero-filled. */
export function fillDailyBuckets(
	counts: Record<string, number>,
	days: number,
	todayMs: number
): { day: string; count: number }[] {
	const DAY = 86_400_000;
	const out: { day: string; count: number }[] = [];
	for (let i = days - 1; i >= 0; i--) {
		const day = utcDay(todayMs - i * DAY);
		out.push({ day, count: counts[day] ?? 0 });
	}
	return out;
}
