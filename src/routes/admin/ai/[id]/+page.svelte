<script lang="ts">
	import ChatMessageRow from '$lib/components/chat/ChatMessageRow.svelte';
	let { data } = $props();
</script>

<div class="rounded-lg border border-navy/10 bg-white p-4 sm:p-6">
	<div class="mb-4">
		<h2 class="text-lg font-semibold text-navy">{data.convo.title}</h2>
		<p class="text-xs text-navy/50">
			{data.convo.email} · {data.convo.rulesetId}{#if data.convo.deletedAt}
				· deleted{/if}
		</p>
	</div>
	<div class="space-y-5">
		{#each data.messages as message (message.id)}
			<ChatMessageRow {message} readonly />
		{/each}
	</div>
</div>
