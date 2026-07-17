<script lang="ts">
	import AskAnswer from '$lib/components/AskAnswer.svelte';
	let { data } = $props();
</script>

<a href="/admin/ai" class="text-sm text-cardinal hover:underline cursor-pointer">← Conversations</a>
<div class="mt-2 mb-4">
	<h2 class="text-lg font-semibold text-navy">{data.convo.title}</h2>
	<p class="text-xs text-navy/50">
		{data.convo.email} · {data.convo.rulesetId}{#if data.convo.deletedAt}
			· deleted{/if}
	</p>
</div>

<div class="space-y-4">
	{#each data.messages as msg (msg.id)}
		{#if msg.role === 'user'}
			<div class="ml-auto max-w-[80%] rounded-lg bg-navy/5 px-3 py-2 text-sm text-navy">
				{msg.content}
			</div>
		{:else}
			<div class="max-w-[90%]">
				{#if msg.status === 'error'}
					<p class="text-sm text-navy/40">No answer — the assistant was unavailable.</p>
				{:else}
					<AskAnswer answer={msg.content} />
					<div class="mt-1 flex gap-2 text-[11px] text-navy/40">
						{#if msg.status === 'truncated'}<span>cut short</span>{/if}
						{#if msg.feedback === 'up'}<span>👍</span>{:else if msg.feedback === 'down'}<span
								>👎</span
							>{/if}
					</div>
				{/if}
			</div>
		{/if}
	{/each}
</div>
