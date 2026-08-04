export function sectionSlugForRuleId(id: string): string | null {
	if (id === 'preface') return 'preface';
	const appendixAnchor = id.match(/^appendix_([a-gA-G])$/);
	if (appendixAnchor) return `appendix-${appendixAnchor[1].toLowerCase()}`;
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
