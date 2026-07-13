<script lang="ts">
	import { untrack } from 'svelte';
	import Chip from '$lib/components/Chip.svelte';
	let { data } = $props();

	const MODE_LABELS = { quick: 'Quick quiz', mastery: 'Section mastery', timed: 'Timed challenge' };
	// Seed local mutable state from the initial load once; not kept reactively synced to `data`,
	// since bookmark removal is applied optimistically here rather than by re-fetching load data.
	let marks = $state(untrack(() => data.bookmarks));

	// Day labels are derived from `data.now` (serialized with the load) rather than the client
	// clock, so server and client agree on "Today" during hydration. Both sides slice the UTC
	// ISO date, so this is stable regardless of the viewer's timezone.
	const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
	const today = $derived(isoDay(data.now));
	const yesterday = $derived(isoDay(data.now - 24 * 60 * 60 * 1000));
	const dayLabel = (ms: number) => {
		const d = isoDay(ms);
		if (d === today) return 'Today';
		if (d === yesterday) return 'Yesterday';
		return d;
	};
	const setLabel = (ms: number) => {
		const label = dayLabel(ms);
		return label === 'Today' || label === 'Yesterday'
			? `Set ${label.toLowerCase()}`
			: `Set ${label}`;
	};

	async function removeBookmark(rulesetId: string, ruleId: string) {
		const prev = marks;
		marks = marks.filter((b) => !(b.rulesetId === rulesetId && b.ruleId === ruleId));
		try {
			const res = await fetch('/api/bookmarks', {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ rulesetId, ruleId })
			});
			if (!res.ok) throw new Error(String(res.status));
		} catch {
			marks = prev;
		}
	}

	// Progress summary — a compact roll-up of the per-section mastery the server load already
	// computes. The full grid lives at /quiz/mastery; this page just points at what's weakest.
	const totalSections = $derived(data.mastery.length);
	const masteredCount = $derived(data.mastery.filter((m) => m.level === 'mastered').length);
	const solidCount = $derived(data.mastery.filter((m) => m.level === 'solid').length);
	const learningCount = $derived(data.mastery.filter((m) => m.level === 'learning').length);
	const segmentPct = (n: number) => (totalSections > 0 ? (100 * n) / totalSections : 0);

	const weakestQuizzed = $derived(
		data.mastery
			.filter((m) => m.attempts > 0 && (m.level === 'learning' || m.level === 'solid'))
			.sort((a, b) => a.recentPct - b.recentPct || a.attempts - b.attempts)
			.slice(0, 3)
	);
	const upNext = $derived(
		weakestQuizzed.length > 0
			? weakestQuizzed
			: data.mastery.filter((m) => m.level === 'unseen').slice(0, 3)
	);
</script>

<svelte:head><title>Dashboard · Best Perspective</title></svelte:head>

<section class="mx-auto max-w-6xl px-4 py-10 sm:px-6">
	<Chip label="Dashboard" />
	<h1 class="display mt-3 text-4xl text-white sm:text-5xl">Your perspective.</h1>
	<p class="mt-2 text-sm text-white/60">{data.user.name} · {data.user.email}</p>

	<div class="mt-8 grid gap-4 lg:grid-cols-3">
		<div class="flex flex-col rounded-xl bg-white p-6 text-navy">
			<h2 class="text-xs font-semibold tracking-[0.18em] text-navy/50 uppercase">Timed best</h2>
			{#if data.timedBest}
				<div class="mt-4 flex items-baseline gap-10">
					<div>
						<p class="display text-5xl">{data.timedBest.score}</p>
						<p class="mt-1 text-xs tracking-wider text-navy/50 uppercase">Correct</p>
					</div>
					<div>
						<p class="display text-5xl">{data.timedBest.bestStreak}</p>
						<p class="mt-1 text-xs tracking-wider text-navy/50 uppercase">Best streak</p>
					</div>
				</div>
				<p class="mt-3 text-xs text-navy/50">{setLabel(data.timedBest.at)}</p>
			{:else}
				<p class="mt-2 text-sm text-navy/60">No timed runs yet.</p>
			{/if}
			<div class="mt-auto pt-5">
				<a
					href="/quiz/timed"
					class="block w-full rounded-full bg-cardinal px-5 py-2.5 text-center text-xs font-semibold tracking-wider text-white uppercase hover:brightness-110"
				>
					{data.timedBest ? 'Beat it' : 'Run the clock'}
				</a>
			</div>
		</div>

		<div class="flex flex-col rounded-xl bg-white p-6 text-navy lg:col-span-2">
			<h2 class="text-xs font-semibold tracking-[0.18em] text-navy/50 uppercase">
				Recent attempts
			</h2>
			{#if data.attempts.length === 0}
				<p class="mt-2 text-sm text-navy/60">Nothing yet. Completed quizzes will appear here.</p>
			{:else}
				<ul class="mt-3 max-h-60 divide-y divide-mist overflow-y-auto">
					{#each data.attempts as attempt (attempt.id)}
						{@const attemptPct =
							attempt.total > 0 ? Math.round((100 * attempt.score) / attempt.total) : 0}
						<li class="flex items-center justify-between gap-3 py-2 text-sm">
							<span>
								<span class="font-semibold">{MODE_LABELS[attempt.mode]}</span>
								{#if attempt.sectionTitle}<span class="text-navy/60"
										>&nbsp;· {attempt.sectionTitle}</span
									>{/if}
							</span>
							<span class="flex shrink-0 items-center gap-2">
								<span class="text-xs text-navy/50">{dayLabel(attempt.createdAt)}</span>
								<span class="font-mono text-navy/80">{attempt.score}/{attempt.total}</span>
								<span
									class="rounded-full px-2 py-0.5 text-xs font-semibold {attemptPct >= 80
										? 'bg-turf/10 text-turf'
										: 'bg-mist text-navy/70'}"
								>
									{attemptPct}%
								</span>
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>

	<div class="mt-4 rounded-xl bg-white p-6 text-navy">
		<h2 class="text-xs font-semibold tracking-[0.18em] text-navy/50 uppercase">Progress</h2>
		<div class="mt-4 flex flex-wrap items-baseline gap-x-8 gap-y-2">
			<div>
				<p class="display text-3xl text-turf">{masteredCount}</p>
				<p class="text-xs tracking-wider text-navy/50 uppercase">Mastered</p>
			</div>
			<div>
				<p class="display text-3xl">{solidCount}</p>
				<p class="text-xs tracking-wider text-navy/50 uppercase">Solid</p>
			</div>
			<div>
				<p class="display text-3xl">{learningCount}</p>
				<p class="text-xs tracking-wider text-navy/50 uppercase">Learning</p>
			</div>
			<p class="text-sm text-navy/50">of {totalSections} sections</p>
		</div>

		<div class="mt-4 flex h-2 overflow-hidden rounded-full bg-mist">
			<div class="bg-turf" style="width: {segmentPct(masteredCount)}%"></div>
			<div class="bg-navy/40" style="width: {segmentPct(solidCount)}%"></div>
			<div class="bg-navy/15" style="width: {segmentPct(learningCount)}%"></div>
		</div>

		{#if upNext.length > 0}
			<div class="mt-5">
				<p class="text-xs tracking-wider text-navy/50 uppercase">
					{weakestQuizzed.length > 0
						? 'Up next — keep sharpening these'
						: "Up next — sections you haven't tried"}
				</p>
				<div class="mt-2 flex flex-wrap gap-2">
					{#each upNext as m (m.sectionSlug)}
						<a
							href="/quiz/mastery?section={m.sectionSlug}"
							class="rounded-full border border-navy/15 px-3 py-1.5 text-sm font-medium text-navy transition-colors hover:border-cardinal hover:text-cardinal"
						>
							{m.number}. {m.title}
						</a>
					{/each}
				</div>
			</div>
		{/if}

		<a href="/quiz/mastery" class="mt-4 inline-block text-sm text-navy/50 hover:text-cardinal">
			Full mastery grid →
		</a>
	</div>

	<h2 class="mt-10 text-xs font-semibold tracking-[0.18em] text-white/50 uppercase">Bookmarks</h2>
	{#if marks.length === 0}
		<p class="mt-3 text-sm text-white/60">Bookmarked rules will appear here.</p>
	{:else}
		<ul class="mt-3 grid gap-2 sm:grid-cols-2">
			{#each marks as mark (mark.rulesetId + mark.ruleId)}
				<li class="flex items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 text-navy">
					<a
						href="/rules/{mark.rulesetId}/{mark.sectionSlug}#{mark.ruleId}"
						class="min-w-0 font-mono text-sm font-semibold text-cardinal hover:underline"
					>
						{mark.ruleId}
						{#if mark.sectionTitle}<span class="ml-2 font-sans font-normal text-navy/60"
								>{mark.sectionTitle}</span
							>{/if}
					</a>
					<button
						type="button"
						aria-label="Remove bookmark {mark.ruleId}"
						onclick={() => removeBookmark(mark.rulesetId, mark.ruleId)}
						class="shrink-0 text-navy/40 hover:text-cardinal"
					>
						<svg aria-hidden="true" class="h-4 w-4" viewBox="0 -960 960 960" fill="currentColor">
							<path
								d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"
							/>
						</svg>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>
