import { safeFetch, safeFetchJson } from '$lib/fetch';
import { BookmarksResponseSchema } from '$lib/bookmarks/payload';
import { createKeyedMutex } from '$lib/optimistic';

/** Signed-in bookmark state for the explorer. Optimistic toggles, silent degradation. */
class BookmarksState {
	enabled = $state(false);
	#keys = $state<ReadonlySet<string>>(new Set());
	#run = createKeyedMutex();

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
		// Reading `had` must happen inside the task: a same-key toggle already
		// queued ahead of this one may still be running (or reverting), and
		// reading live state here, before this task's turn, would race it.
		await this.#run(key, async () => {
			const had = this.#keys.has(key);
			const next = new Set(this.#keys);
			if (had) next.delete(key);
			else next.add(key);
			this.#keys = next; // optimistic
			const ok = (
				await safeFetch('/api/bookmarks', {
					method: had ? 'DELETE' : 'PUT',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ rulesetId, ruleId })
				})
			).ok;
			if (!ok) {
				// Inverse of the optimistic apply above, computed from live state —
				// a concurrent toggle of a different key must survive this.
				const revert = new Set(this.#keys);
				if (had) revert.add(key);
				else revert.delete(key);
				this.#keys = revert;
			}
		});
	}
}

export const bookmarks = new BookmarksState();
