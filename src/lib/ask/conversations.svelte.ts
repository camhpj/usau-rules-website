import type { ConversationListResponse, ConversationSummary } from '$lib/ai/payload';

/** Sidebar conversation list. Optimistic delete, silent-degrading fetches. */
class ConversationsState {
	list = $state<ConversationSummary[]>([]);
	hasMore = $state(false);
	loading = $state(true);
	loadingMore = $state(false);
	errorMessage = $state<string | null>(null);

	async #fetchPage(before: number | null): Promise<ConversationListResponse | null> {
		try {
			const res = await fetch(
				before === null ? '/api/ai/conversations' : `/api/ai/conversations?before=${before}`
			);
			if (!res.ok) return null;
			return (await res.json()) as ConversationListResponse;
		} catch {
			return null;
		}
	}

	async load(): Promise<void> {
		this.loading = true;
		const page = await this.#fetchPage(null);
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
		const page = await this.#fetchPage(this.list[this.list.length - 1].updatedAt);
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

	/** Swap an optimistic entry for the server's real conversation, in place. */
	resolve(tempId: string, convo: ConversationSummary): void {
		this.list = this.list.map((c) => (c.id === tempId ? convo : c));
	}

	/** Remove a local-only entry (no server call). */
	drop(id: string): void {
		this.list = this.list.filter((c) => c.id !== id);
	}

	async remove(id: string): Promise<boolean> {
		const prev = this.list;
		this.list = this.list.filter((c) => c.id !== id); // optimistic
		try {
			const res = await fetch(`/api/ai/conversations/${encodeURIComponent(id)}`, {
				method: 'DELETE'
			});
			if (!res.ok) throw new Error(String(res.status));
			return true;
		} catch {
			this.list = prev; // rollback
			this.errorMessage = "Couldn't delete that conversation — try again.";
			return false;
		}
	}

	reset(): void {
		this.list = [];
		this.hasMore = false;
		this.loading = true;
		this.errorMessage = null;
	}
}

export const conversations = new ConversationsState();
