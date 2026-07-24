<script lang="ts">
	import { timeAgo } from '$lib/time';
	let { data } = $props();
</script>

<div class="mb-3 flex items-center gap-3 text-sm">
	<a
		href="/admin/ai"
		class="cursor-pointer {data.downOnly ? 'text-navy/60' : 'font-semibold text-cardinal'}">All</a
	>
	<a
		href="/admin/ai?down=1"
		class="cursor-pointer {data.downOnly ? 'font-semibold text-cardinal' : 'text-navy/60'}"
		>👎 only</a
	>
</div>

{#if data.conversations.length === 0}
	<p class="text-navy/60">No conversations.</p>
{:else}
	<table class="w-full text-sm">
		<thead class="text-left text-xs text-navy/50">
			<tr
				><th class="py-1">Title</th><th>User</th><th>Msgs</th><th></th><th class="text-right"
					>Updated</th
				></tr
			>
		</thead>
		<tbody>
			{#each data.conversations as c (c.id)}
				<tr class="border-t border-navy/5">
					<td class="py-2"
						><a class="cursor-pointer text-cardinal hover:underline" href="/admin/ai/{c.id}"
							>{c.title}</a
						>{#if c.deletedAt}<span class="ml-2 rounded bg-navy/10 px-1 text-[10px] text-navy/50"
								>deleted</span
							>{/if}</td
					>
					<td class="text-navy/70">{c.email}</td>
					<td class="text-navy/70">{c.messages}</td>
					<td
						>{#if c.hasDown}<span title="has a 👎">👎</span>{/if}</td
					>
					<td class="text-right text-navy/50">{timeAgo(c.updatedAt)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
	{#if data.hasMore}
		<a
			class="mt-3 inline-block cursor-pointer text-sm text-cardinal"
			href="/admin/ai?{data.downOnly ? 'down=1&' : ''}before={data.nextBefore}">Load more</a
		>
	{/if}
{/if}
