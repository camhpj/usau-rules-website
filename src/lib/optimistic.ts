/**
 * Run an optimistic mutation, reverting only if no newer mutation for the same
 * key has started since.
 *
 * `revert` must be an inverse operation over current state, not a restore of a
 * snapshot captured before `request` — a snapshot restore discards unrelated
 * mutations that landed while the request was in flight.
 */
export function createOptimistic() {
	const generation = new Map<string, number>();

	return async function optimistic(
		key: string,
		steps: { apply: () => void; revert: () => void; request: () => Promise<boolean> }
	): Promise<boolean> {
		const mine = (generation.get(key) ?? 0) + 1;
		generation.set(key, mine);
		steps.apply();
		const ok = await steps.request();
		// A newer mutation for this key has already replaced our optimistic value
		// and owns the outcome. Reverting now would clobber it.
		if (!ok && generation.get(key) === mine) steps.revert();
		return ok;
	};
}
