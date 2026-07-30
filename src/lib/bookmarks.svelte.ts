import { BookmarksResponseSchema } from '$lib/bookmarks/payload';

/** Signed-in bookmark state for the explorer. Optimistic toggles, silent degradation. */
class BookmarksState {
	enabled = $state(false);
	#keys = $state<ReadonlySet<string>>(new Set());

	#key(rulesetId: string, ruleId: string): string {
		return `${rulesetId}::${ruleId}`;
	}

	async load(): Promise<void> {
		let res: Response;
		try {
			res = await fetch('/api/bookmarks');
		} catch {
			return;
		}
		if (!res.ok) return; // 401 → stay disabled
		const body = await res.json().catch(() => null);
		const parsed = BookmarksResponseSchema.safeParse(body);
		if (!parsed.success) return;
		this.#keys = new Set(parsed.data.bookmarks.map((b) => this.#key(b.rulesetId, b.ruleId)));
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
		const next = new Set(this.#keys);
		if (had) next.delete(key);
		else next.add(key);
		this.#keys = next; // optimistic
		try {
			const res = await fetch('/api/bookmarks', {
				method: had ? 'DELETE' : 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ rulesetId, ruleId })
			});
			if (!res.ok) throw new Error(String(res.status));
		} catch {
			const revert = new Set(this.#keys);
			if (had) revert.add(key);
			else revert.delete(key);
			this.#keys = revert;
		}
	}
}

export const bookmarks = new BookmarksState();
