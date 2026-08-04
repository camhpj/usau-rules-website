import { safeFetch } from '$lib/fetch';
import { createKeyedMutex } from '$lib/optimistic';

export interface Bookmark {
	rulesetId: string;
	ruleId: string;
	createdAt: number;
	sectionSlug: string | null;
	sectionTitle: string | null;
}

// There is only one display name, so any two removals contend for it.
const DISPLAY_NAME_KEY = 'display-name';

/**
 * `/me` dashboard state: optimistic bookmark removal and display-name
 * removal. Each is serialized per key (see `createKeyedMutex`) so overlapping
 * mutations settle in order, and a failure's revert is computed from live
 * state rather than a stale snapshot — a concurrent change that lands while a
 * request is in flight survives a later failure.
 */
export class MePageState {
	marks = $state<Bookmark[]>([]);
	displayName = $state<string | null>(null);
	errorMessage = $state<string | null>(null);
	#run = createKeyedMutex();

	constructor(marks: Bookmark[], displayName: string | null) {
		this.marks = marks;
		this.displayName = displayName;
	}

	#bookmarkKey(rulesetId: string, ruleId: string): string {
		return `${rulesetId}::${ruleId}`;
	}

	/**
	 * Re-insert a removed bookmark into the current list, preserving the same
	 * primary order the server returns (see `fetchBookmarks`): createdAt
	 * descending. The ruleset/rule key tiebreak for equal timestamps is local
	 * and arbitrary — the server leaves ties unspecified — it only exists to
	 * make the insertion point deterministic.
	 */
	#reinsertBookmark(mark: Bookmark): void {
		const key = this.#bookmarkKey(mark.rulesetId, mark.ruleId);
		const rest = this.marks.filter((b) => this.#bookmarkKey(b.rulesetId, b.ruleId) !== key);
		const at = rest.findIndex(
			(b) =>
				b.createdAt < mark.createdAt ||
				(b.createdAt === mark.createdAt && this.#bookmarkKey(b.rulesetId, b.ruleId) < key)
		);
		const index = at === -1 ? rest.length : at;
		this.marks = [...rest.slice(0, index), mark, ...rest.slice(index)];
	}

	async removeBookmark(rulesetId: string, ruleId: string): Promise<void> {
		// Reading the current list must happen inside the task: a same-key
		// removal already queued ahead of this one may still be running (or
		// re-inserting), and reading live state here, before this task's turn,
		// would race it.
		const ok = await this.#run(this.#bookmarkKey(rulesetId, ruleId), async () => {
			this.errorMessage = null;
			const key = this.#bookmarkKey(rulesetId, ruleId);
			const removed = this.marks.find((b) => this.#bookmarkKey(b.rulesetId, b.ruleId) === key);
			if (removed)
				this.marks = this.marks.filter((b) => this.#bookmarkKey(b.rulesetId, b.ruleId) !== key); // optimistic
			const requestOk = (
				await safeFetch('/api/bookmarks', {
					method: 'DELETE',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ rulesetId, ruleId })
				})
			).ok;
			// Re-insert the one bookmark we removed into whatever the list looks
			// like now — an unrelated bookmark change that landed mid-flight survives.
			if (!requestOk && removed) this.#reinsertBookmark(removed);
			return requestOk;
		});
		if (!ok) this.errorMessage = "Couldn't remove that bookmark — try again.";
	}

	async removeName(): Promise<void> {
		// Same reasoning as removeBookmark: `before` must be read inside the
		// task so a same-key removal already queued ahead of this one has fully
		// settled first.
		const ok = await this.#run(DISPLAY_NAME_KEY, async () => {
			this.errorMessage = null;
			const before = this.displayName;
			if (before !== null) this.displayName = null; // optimistic
			const requestOk = (
				await safeFetch('/api/profile/display-name', {
					method: 'PUT',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ displayName: null })
				})
			).ok;
			// DisplayNameClaim's onSaved writes `displayName` directly, outside
			// this mutex — a claim that lands and confirms mid-flight owns the
			// field. Only revert if it's still null, i.e. nothing has claimed a
			// new name since this removal's optimistic clear.
			if (!requestOk && before !== null && this.displayName === null) this.displayName = before;
			return requestOk;
		});
		if (!ok) this.errorMessage = "Couldn't remove your name — try again.";
	}
}
