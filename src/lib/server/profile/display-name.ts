import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity';

/** Leaderboard display-name rules (spec): trim; 2–30 chars; letters/digits/space/.'-; no profanity. */

const matcher = new RegExpMatcher({
	...englishDataset.build(),
	...englishRecommendedTransformers
});

export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 30;
const CHARSET = /^[\p{L}\p{N} .'-]+$/u;

export function validateDisplayName(
	raw: string
): { ok: true; name: string } | { ok: false; reason: string } {
	const name = raw.trim().replace(/\s+/g, ' ');
	if (name.length < DISPLAY_NAME_MIN || name.length > DISPLAY_NAME_MAX) {
		return { ok: false, reason: `use ${DISPLAY_NAME_MIN}–${DISPLAY_NAME_MAX} characters` };
	}
	if (!CHARSET.test(name)) {
		return { ok: false, reason: "letters, numbers, spaces, and . ' - only" };
	}
	if (matcher.hasMatch(name)) {
		return { ok: false, reason: 'that name isn’t allowed' };
	}
	return { ok: true, name };
}

/** "Cameron Johnson" → "Cameron J."; single names pass through; empty → "Player". */
export function suggestDisplayName(fullName: string): string {
	const parts = fullName.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return 'Player';
	if (parts.length === 1) return parts[0].slice(0, DISPLAY_NAME_MAX);
	const last = parts[parts.length - 1];
	return `${parts[0]} ${last[0].toUpperCase()}.`.slice(0, DISPLAY_NAME_MAX);
}

const SUFFIX_CAP = 50;

/** base if free, else "base 2" … "base 50"; null when exhausted or a suffixed candidate can't fit. */
export async function resolveUniqueName(
	base: string,
	isTaken: (candidate: string) => Promise<boolean>
): Promise<string | null> {
	if (!(await isTaken(base))) return base;
	for (let n = 2; n <= SUFFIX_CAP; n++) {
		const candidate = `${base} ${n}`;
		if (candidate.length > DISPLAY_NAME_MAX) return null;
		if (!(await isTaken(candidate))) return candidate;
	}
	return null;
}
