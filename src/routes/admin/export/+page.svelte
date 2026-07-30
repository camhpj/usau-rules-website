<script lang="ts">
	let { data } = $props();
</script>

<ul class="space-y-2">
	{#each data.datasets as d (d.slug)}
		<li class="flex items-center justify-between rounded-lg border border-navy/10 bg-white p-3">
			<div>
				<div class="text-sm font-medium text-navy">{d.label}</div>
				<div class="text-xs text-navy/50">{d.count.toLocaleString()} rows</div>
			</div>
			<a
				class="cursor-pointer rounded bg-cardinal px-3 py-1.5 text-sm font-medium text-white"
				href="/admin/export/{d.slug}.csv">Download</a
			>
		</li>
	{/each}
</ul>
