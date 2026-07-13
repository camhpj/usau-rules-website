import { nearestKnownRuleId } from './rule-ids';

export type CitationSegment =
	{ type: 'text'; text: string } | { type: 'ref'; id: string; anchorId: string };

const REF_PATTERN = /\[([0-9A-Za-z][0-9A-Za-z._-]{0,31})\]/g;

/**
 * Split AI answer text into plain-text and rule-reference segments. An id is
 * a ref only if it (or its nearest dotted ancestor) is present in validIds
 * (the verify-before-display rule) — e.g. a model-cited inline-letter id like
 * `15.F.2.b` links to its known parent `15.F.2`. Anything else — hallucinated
 * ids, plain bracketed words — stays literal text.
 */
export function segmentCitations(text: string, validIds: ReadonlySet<string>): CitationSegment[] {
	const segments: CitationSegment[] = [];
	let last = 0;
	for (const match of text.matchAll(REF_PATTERN)) {
		const id = match[1];
		const anchorId = nearestKnownRuleId(id, validIds);
		if (anchorId === null) continue;
		if (match.index > last) segments.push({ type: 'text', text: text.slice(last, match.index) });
		segments.push({ type: 'ref', id, anchorId });
		last = match.index + match[0].length;
	}
	if (last < text.length) segments.push({ type: 'text', text: text.slice(last) });
	return segments;
}
