/** Parse an appendix anchor id (`appendix_a`) into its section slug and letter. */
export function matchAppendixAnchor(id: string): { slug: string; letter: string } | null {
	const match = id.match(/^appendix_([a-gA-G])$/);
	if (!match) return null;
	return { slug: `appendix-${match[1].toLowerCase()}`, letter: match[1].toUpperCase() };
}

/**
 * Human-readable label for a rule reference: `appendix_g` renders as `Appendix G`.
 *
 * Returns `id` itself for everything else, and call sites rely on that: they
 * compare the label against the id to decide whether to keep the monospace
 * styling that suits a raw rule id but not prose.
 */
export function ruleRefLabel(id: string): string {
	const appendix = matchAppendixAnchor(id);
	return appendix ? `Appendix ${appendix.letter}` : id;
}

export function sectionSlugForRuleId(id: string): string | null {
	if (id === 'preface') return 'preface';
	const appendixAnchor = matchAppendixAnchor(id);
	if (appendixAnchor) return appendixAnchor.slug;
	const appendixRule = id.match(/^([A-Za-z])\d/);
	if (appendixRule) return `appendix-${appendixRule[1].toLowerCase()}`;
	const numeric = id.match(/^(\d+)/);
	if (numeric) return numeric[1];
	return null;
}

/** `id` itself if known, else the nearest dotted ancestor present in `ids`, else null. */
export function nearestKnownRuleId(id: string, ids: ReadonlySet<string>): string | null {
	if (ids.has(id)) return id;
	let ancestor = id;
	while (ancestor.includes('.')) {
		ancestor = ancestor.slice(0, ancestor.lastIndexOf('.'));
		if (ids.has(ancestor)) return ancestor;
	}
	return null;
}
