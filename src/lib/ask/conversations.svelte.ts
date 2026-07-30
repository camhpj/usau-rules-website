import { safeFetch, safeFetchJson } from '$lib/fetch';
import { createOptimistic } from '$lib/optimistic';
import {
	ConversationListResponseSchema,
	type ConversationListResponse,
	type ConversationSummary
} from '$lib/ai/payload';

/** Sidebar conversation list. Optimistic delete, silent-degrading fetches. */
export class ConversationsState {
	list = $state<ConversationSummary[]>([]);
	hasMore = $state(false);
	loading = $state(true);
	loadingMore = $state(false);
	errorMessage = $state<string | null>(null);
	#optimistic = createOptimistic();

	async #fetchPage(
		before: number | null,
		beforeId: string | null
	): Promise<ConversationListResponse | null> {
		// updated_at is not unique, so beforeId breaks ties; it is meaningless
		// without before, and the server ignores it if before is absent.
		const params = new URLSearchParams();
		if (before !== null) {
			params.set('before', String(before));
			if (beforeId !== null) params.set('beforeId', beforeId);
		}
		const query = params.toString();
		const result = await safeFetchJson(
			`/api/ai/conversations${query ? `?${query}` : ''}`,
			undefined,
			ConversationListResponseSchema
		);
		return result.ok ? result.data : null;
	}

	async load(): Promise<void> {
		this.loading = true;
		const page = await this.#fetchPage(null, null);
		this.loading = false;
		if (!page) {
			this.errorMessage = "Couldn't load your conversations.";
			return;
		}
		this.errorMessage = null;
		// A conversation may have been prepended while the fetch was in flight — keep it.
		const ids = new Set(this.list.map((c) => c.id));
		this.list = [...this.list, ...page.conversations.filter((c) => !ids.has(c.id))];
		this.hasMore = page.hasMore;
	}

	async loadMore(): Promise<void> {
		if (this.loadingMore || this.list.length === 0) return;
		this.loadingMore = true;
		const last = this.list[this.list.length - 1];
		const page = await this.#fetchPage(last.updatedAt, last.id);
		this.loadingMore = false;
		if (!page) {
			this.errorMessage = "Couldn't load your conversations.";
			return;
		}
		this.errorMessage = null;
		this.list = [...this.list, ...page.conversations];
		this.hasMore = page.hasMore;
	}

	prepend(convo: ConversationSummary): void {
		this.list = [convo, ...this.list.filter((c) => c.id !== convo.id)];
	}

	/** Bump a conversation to the top after a new message. */
	touch(id: string, updatedAt: number): void {
		const convo = this.list.find((c) => c.id === id);
		if (!convo) return;
		this.list = [{ ...convo, updatedAt }, ...this.list.filter((c) => c.id !== id)];
	}

	/** Swap an optimistic entry for the server's real conversation, in place.
	 * A background load() may have already fetched the real row while the send
	 * was pre-headers — drop that copy so the resolved entry's id stays unique. */
	resolve(tempId: string, convo: ConversationSummary): void {
		this.list = this.list
			.filter((c) => c.id !== convo.id)
			.map((c) => (c.id === tempId ? convo : c));
	}

	/** Remove a local-only entry (no server call). */
	drop(id: string): void {
		this.list = this.list.filter((c) => c.id !== id);
	}

	/** Re-insert a removed summary into the current list, preserving updatedAt-descending order. */
	#reinsert(summary: ConversationSummary): void {
		const rest = this.list.filter((c) => c.id !== summary.id);
		const at = rest.findIndex((c) => c.updatedAt < summary.updatedAt);
		const index = at === -1 ? rest.length : at;
		this.list = [...rest.slice(0, index), summary, ...rest.slice(index)];
	}

	async remove(id: string): Promise<boolean> {
		const removed = this.list.find((c) => c.id === id) ?? null;
		const ok = await this.#optimistic(id, {
			apply: () => {
				if (removed) this.list = this.list.filter((c) => c.id !== id);
			},
			// Re-insert the one summary we removed, into whatever the list looks
			// like now — a prepend() or touch() that landed mid-flight survives.
			revert: () => {
				if (removed) this.#reinsert(removed);
			},
			request: async () =>
				(
					await safeFetch(`/api/ai/conversations/${encodeURIComponent(id)}`, {
						method: 'DELETE'
					})
				).ok
		});
		if (!ok) this.errorMessage = "Couldn't delete that conversation — try again.";
		return ok;
	}

	reset(): void {
		this.list = [];
		this.hasMore = false;
		this.loading = true;
		this.errorMessage = null;
	}
}

export const conversations = new ConversationsState();
