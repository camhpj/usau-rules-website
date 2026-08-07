<script lang="ts">
	import { timeAgo } from '$lib/time';
	import ThumbIcon from '$lib/components/icons/ThumbIcon.svelte';
	let { data } = $props();

	/** Encode a page's fetch cursor as a single URL-safe token. */
	function encodeCursor(before: number | null, beforeId: string | null): string {
		return before === null ? 'start' : `${before}:${beforeId ?? ''}`;
	}

	/** Decode a token pushed by encodeCursor back into a cursor. */
	function decodeCursor(token: string): { before: number | null; beforeId: string | null } {
		if (token === 'start') return { before: null, beforeId: null };
		const [before, beforeId] = token.split(':');
		return { before: Number(before), beforeId: beforeId === '' ? null : beforeId };
	}

	function buildHref(before: number | null, beforeId: string | null, stack: string[]): string {
		const params = new URLSearchParams();
		if (data.downOnly) params.set('down', '1');
		if (before !== null) {
			params.set('before', String(before));
			params.set('beforeId', beforeId ?? '');
		}
		if (stack.length) params.set('stack', stack.join(','));
		return `/admin/ai?${params.toString()}`;
	}

	let nextHref = $derived(
		buildHref(data.nextBefore, data.nextBeforeId, [
			...data.stack,
			encodeCursor(data.before, data.beforeId)
		])
	);
	let prevHref = $derived.by(() => {
		if (data.stack.length === 0) return null;
		const prevStack = data.stack.slice(0, -1);
		const { before, beforeId } = decodeCursor(data.stack[data.stack.length - 1]);
		return buildHref(before, beforeId, prevStack);
	});
</script>

<div class="rounded-lg border border-navy/10 bg-white p-4">
	{#if data.conversations.length === 0}
		<p class="text-navy/60">No conversations.</p>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full min-w-[36rem] table-fixed text-sm">
				<thead class="text-left text-xs text-navy/50">
					<tr
						><th class="py-1">Title</th><th>User</th><th>Messages</th><th>Feedback</th><th
							class="text-right">Updated</th
						></tr
					>
				</thead>
				<tbody>
					{#each data.conversations as c (c.id)}
						<tr class="border-t border-navy/5">
							<td class="max-w-0 py-1"
								><div class="flex pointer-coarse:min-h-11">
									<a
										class="flex min-w-0 items-center self-stretch truncate text-cardinal hover:underline"
										href="/admin/ai/{c.id}">{c.title}</a
									>{#if c.deletedAt}<span
											class="ml-2 shrink-0 self-center rounded bg-navy/10 px-1 text-[10px] text-navy/50"
											>deleted</span
										>{/if}
								</div></td
							>
							<td class="max-w-0 truncate text-navy/70">{c.email}</td>
							<td class="text-navy/70">{c.messages}</td>
							<td
								>{#if c.hasDown}<span title="thumbs down" class="inline-flex text-navy/60"
										><ThumbIcon direction="down" class="block h-4 w-4" /></span
									>{/if}</td
							>
							<td class="text-right text-navy/50">{timeAgo(c.updatedAt)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<div class="mt-3 flex items-center gap-3 text-sm">
			{#if prevHref}
				<a
					class="cursor-pointer text-cardinal pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:items-center pointer-coarse:justify-center"
					href={prevHref}>Previous</a
				>
			{/if}
			{#if data.hasMore}
				<a
					class="cursor-pointer text-cardinal pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:items-center pointer-coarse:justify-center"
					href={nextHref}>Next</a
				>
			{/if}
			<span class="text-navy/50">Page {data.pageNumber}</span>
		</div>
	{/if}
</div>
