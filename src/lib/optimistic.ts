/**
 * Serialize async work per key.
 *
 * Optimistic updates need this: two overlapping mutations of the same key can
 * resolve out of order, and a revert computed against an unconfirmed optimistic
 * value never returns to what the server holds. Running them in order means
 * each one reads the true current state and its inverse revert is correct.
 */
export function createKeyedMutex() {
	const chains = new Map<string, Promise<unknown>>();
	return function run<T>(key: string, task: () => Promise<T>): Promise<T> {
		const prior = chains.get(key) ?? Promise.resolve();
		const next = prior.then(task, task);
		const settled = next.then(
			() => {},
			() => {}
		);
		chains.set(key, settled);
		void settled.then(() => {
			if (chains.get(key) === settled) chains.delete(key);
		});
		return next;
	};
}
