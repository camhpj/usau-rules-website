<script lang="ts">
	import Chip from '$lib/components/Chip.svelte';
	let { data } = $props();
</script>

<svelte:head><title>Rulebooks · Best Perspective</title></svelte:head>

<div class="mx-auto max-w-6xl px-4 py-12 sm:px-6">
	<p class="text-xs font-semibold tracking-[0.18em] text-white/50 uppercase">Explore</p>
	<h1 class="display mt-2 text-4xl text-white sm:text-5xl">
		Rule<span class="text-cardinal">books</span>
	</h1>
	<p class="mt-3 max-w-xl text-sm text-white/60">
		Pick a ruleset to browse its full table of contents.
	</p>

	<div class="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
		{#each data.rulesets as ruleset (ruleset.id)}
			{@const ruleCount = ruleset.sections.reduce((sum, s) => sum + s.ruleCount, 0)}
			<a
				href="/rules/{ruleset.id}"
				class="group relative block card card-link p-6 pr-14"
			>
				<Chip label={ruleset.edition} tone="dark" />
				<h2 class="display mt-4 text-2xl text-navy">{ruleset.shortTitle}</h2>
				<p class="mt-2 text-sm text-navy/60">
					{ruleset.sections.length} sections · {ruleCount} rules
				</p>
				<span
					class="absolute top-6 right-6 flex h-8 w-8 items-center justify-center rounded-full bg-cardinal text-white transition-transform group-hover:translate-x-0.5"
					aria-hidden="true"
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.4"
						stroke-linecap="round"
						stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg
					>
				</span>
			</a>
		{/each}
	</div>
</div>
