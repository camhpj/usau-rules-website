/**
 * Offsets (relative to a container) of the page-space gridlines — multiples
 * of `tile` — that fall inside a container starting at `pageOffset` and
 * spanning `spanLength`. Lines within half a tile of either edge are
 * excluded so pulses never hug the container boundary.
 */
export function gridLineOffsets(pageOffset: number, spanLength: number, tile: number): number[] {
	const margin = tile / 2;
	const first = Math.ceil((pageOffset + margin) / tile);
	const last = Math.floor((pageOffset + spanLength - margin) / tile);
	const offsets: number[] = [];
	for (let k = first; k <= last; k++) offsets.push(k * tile - pageOffset);
	return offsets;
}
