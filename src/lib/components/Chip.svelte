<script lang="ts">
	let { label, tone = 'light' }: { label: string; tone?: 'light' | 'dark' } = $props();
</script>

<span
	class="inline-block rounded-sm border border-cardinal px-2.5 py-1 text-[11px] font-semibold tracking-[0.18em] uppercase
		{tone === 'dark' ? 'text-cardinal' : 'text-white'}"
>
	{label}
</span>
