<script lang="ts">
	import TocSidebar from '$lib/components/rules/TocSidebar.svelte';
	import RuleNode from '$lib/components/rules/RuleNode.svelte';
	import GlossaryPopover from '$lib/components/rules/GlossaryPopover.svelte';
	import { afterNavigate } from '$app/navigation';
	import { hasQuestions } from '$lib/quiz/bank-index';
	let { data } = $props();
	const idx = $derived(data.manifest.sections.findIndex((s) => s.slug === data.section.slug));
	const prev = $derived(data.manifest.sections[idx - 1]);
	const next = $derived(data.manifest.sections[idx + 1]);
	const quizzable = $derived(hasQuestions(data.manifest.id, data.section.slug));

	let articleEl = $state<HTMLElement>();
	let flashTimer: ReturnType<typeof setTimeout> | undefined;
	let flashedEl: HTMLElement | undefined;

	afterNavigate(() => {
		const id = decodeURIComponent(location.hash.slice(1));
		if (!id) return;
		const el = document.getElementById(id);
		if (!el) return;
		clearTimeout(flashTimer);
		flashedEl?.classList.remove('anchor-flash');
		el.scrollIntoView({ block: 'start' });
		el.classList.add('anchor-flash');
		flashedEl = el;
		flashTimer = setTimeout(() => el.classList.remove('anchor-flash'), 2000);
	});
</script>

<svelte:head
	><title>{data.section.title} · {data.manifest.shortTitle} · Best Perspective</title></svelte:head
>

<div class="mx-auto flex max-w-6xl gap-8 px-4 py-8 sm:px-6">
	<aside
		class="sticky top-24 hidden max-h-[calc(100vh-8rem)] w-64 shrink-0 self-start overflow-y-auto lg:block"
	>
		<TocSidebar manifest={data.manifest} current={data.section.slug} />
	</aside>

	<article bind:this={articleEl} class="min-w-0 flex-1 rounded-xl bg-white p-6 text-navy sm:p-10">
		<p class="text-xs font-semibold tracking-[0.18em] text-navy/50 uppercase">
			{data.manifest.title} · {data.manifest.edition}
		</p>
		<h1 class="display mt-2 text-4xl text-navy sm:text-5xl">
			{#if data.section.number}<span class="text-cardinal">{data.section.number}.</span>{/if}
			{data.section.title}
		</h1>

		{#if quizzable}
			<a
				href="/quiz/mastery?section={data.section.slug}"
				class="mt-4 inline-flex items-center gap-1.5 rounded-full border border-cardinal/50 px-4 py-1.5 text-xs font-semibold tracking-wider text-cardinal uppercase transition-colors hover:bg-cardinal hover:text-white"
			>
				Quiz me on this section →
			</a>
		{/if}

		{#if data.section.html}
			<div class="rule-html mt-6 leading-relaxed">{@html data.section.html}</div>
		{/if}
		{#each data.section.rules as rule (rule.id)}
			<RuleNode node={rule} rulesetId={data.manifest.id} />
		{/each}

		<nav class="mt-10 flex justify-between border-t border-mist pt-6 text-sm font-semibold">
			{#if prev}<a
					class="text-navy/70 hover:text-cardinal"
					href="/rules/{data.manifest.id}/{prev.slug}">← {prev.title}</a
				>{:else}<span></span>{/if}
			{#if next}<a
					class="text-navy/70 hover:text-cardinal"
					href="/rules/{data.manifest.id}/{next.slug}">{next.title} →</a
				>{/if}
		</nav>
	</article>
</div>

<GlossaryPopover glossary={data.glossary} rulesetId={data.manifest.id} container={articleEl} />
