import { safeFetch, safeFetchJson } from '$lib/fetch';
import { BookmarksResponseSchema } from '$lib/bookmarks/payload';
import { createOptimistic } from '$lib/optimistic';

/** Signed-in bookmark state for the explorer. Optimistic toggles, silent degradation. */
class BookmarksState {
	enabled = $state(false);
	#keys = $state<ReadonlySet<string>>(new Set());
	#optimistic = createOptimistic();

	#key(rulesetId: string, ruleId: string): string {
		return `${rulesetId}::${ruleId}`;
	}

	async load(): Promise<void> {
		const result = await safeFetchJson('/api/bookmarks', undefined, BookmarksResponseSchema);
		if (!result.ok) return; // 401/offline/malformed → stay disabled
		this.#keys = new Set(result.data.bookmarks.map((b) => this.#key(b.rulesetId, b.ruleId)));
		this.enabled = true;
	}

	reset(): void {
		this.enabled = false;
		this.#keys = new Set();
	}

	has(rulesetId: string, ruleId: string): boolean {
		return this.#keys.has(this.#key(rulesetId, ruleId));
	}

	async toggle(rulesetId: string, ruleId: string): Promise<void> {
		const key = this.#key(rulesetId, ruleId);
		const had = this.#keys.has(key);
		await this.#optimistic(key, {
			apply: () => {
				const next = new Set(this.#keys);
				if (had) next.delete(key);
				else next.add(key);
				this.#keys = next;
			},
			// Inverse of apply, computed from live state — a concurrent toggle of
			// a different key must survive this.
			revert: () => {
				const next = new Set(this.#keys);
				if (had) next.add(key);
				else next.delete(key);
				this.#keys = next;
			},
			request: async () =>
				(
					await safeFetch('/api/bookmarks', {
						method: had ? 'DELETE' : 'PUT',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ rulesetId, ruleId })
					})
				).ok
		});
	}
}

export const bookmarks = new BookmarksState();
