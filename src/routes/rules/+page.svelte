<script lang="ts">
	let { data } = $props();

	const preface = $derived(data.manifest.sections.filter((s) => s.kind === 'preface'));
	const sections = $derived(data.manifest.sections.filter((s) => s.kind === 'section'));
	const appendices = $derived(data.manifest.sections.filter((s) => s.kind === 'appendix'));

	const sourceHost = $derived.by(() => {
		try {
			return new URL(data.manifest.sourceUrl).host;
		} catch {
			return data.manifest.sourceUrl;
		}
	});
</script>

<svelte:head><title>{data.manifest.shortTitle} · Best Perspective</title></svelte:head>

<div class="mx-auto max-w-6xl px-4 py-12 sm:px-6">
	<!-- the edition rides at a third of the title's size so the whole heading
		 still fits on one line on a desktop viewport -->
	<h1 class="display animate-fade-up text-5xl text-white sm:text-6xl">
		{data.manifest.title}
		<span class="text-2xl text-white/60 sm:text-3xl">({data.manifest.edition})</span>
	</h1>
	<a
		href={data.manifest.sourceUrl}
		target="_blank"
		rel="noopener noreferrer"
		class="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm text-white/60 underline decoration-white/30 underline-offset-2 hover:text-white/85"
	>
		Source: {sourceHost} ↗
	</a>

	{#each [{ heading: 'Preface', items: preface }, { heading: 'Sections', items: sections }, { heading: 'Appendices', items: appendices }] as group (group.heading)}
		{#if group.items.length > 0}
			<h2 class="eyebrow mt-7 text-white/50">
				{group.heading}
			</h2>
			<div class="mt-3 grid gap-2 sm:grid-cols-2">
				{#each group.items as s (s.slug)}
					<a
						href="/rules/{data.manifest.id}/{s.slug}"
						class="group flex items-center justify-between gap-3 card card-link p-4"
					>
						<!-- number and title are flex siblings, not inline ones, so a two-digit
							 number cannot push the title right and a wrapped title stays aligned
							 with its own first line. 3ch is a floor rather than a fixed width:
							 it holds today's widest label ("23.") in the mono face this span
							 sets, and a longer one would widen the column instead of spilling.
							 Right-aligned to match TocSidebar. -->
						<span class="flex min-w-0 items-baseline gap-1.5">
							{#if s.number}
								<span
									class="min-w-[3ch] shrink-0 text-right font-mono text-sm font-semibold text-cardinal"
								>
									{s.number}.
								</span>
							{/if}
							<span class="min-w-0 font-semibold">{s.title}</span>
						</span>
						<span class="flex shrink-0 items-center gap-3">
							{#if s.ruleCount > 0}
								<span class="text-xs text-navy/50">{s.ruleCount} rules</span>
							{/if}
							<span
								class="flex h-6 w-6 items-center justify-center rounded-full bg-cardinal text-white transition-transform group-hover:translate-x-0.5"
								aria-hidden="true"
							>
								<svg
									width="11"
									height="11"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2.6"
									stroke-linecap="round"
									stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg
								>
							</span>
						</span>
					</a>
				{/each}
			</div>
		{/if}
	{/each}
</div>
