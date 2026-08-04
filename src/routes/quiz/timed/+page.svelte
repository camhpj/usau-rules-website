<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/Button.svelte';
	import DisplayNameClaim from '$lib/components/DisplayNameClaim.svelte';
	import QuestionPlayer from '$lib/components/quiz/QuestionPlayer.svelte';
	import QuizSummary from '$lib/components/quiz/QuizSummary.svelte';
	import { DEFAULT_RULESET_ID } from '$lib/content/config';
	import { TimedRunState } from '$lib/quiz/timed-run.svelte';

	const run = new TimedRunState();

	onMount(() => {
		run.mount();
		return () => run.destroy();
	});
</script>

<svelte:head><title>Timed challenge · Best Perspective</title></svelte:head>

<section class="mx-auto max-w-3xl px-4 py-10 sm:px-6">
	<p class="eyebrow text-cardinal">Timed challenge</p>

	{#if run.phase === 'intro'}
		<h1 class="display mt-2 text-4xl text-white sm:text-5xl">Five minutes.</h1>
		<p class="mt-3 max-w-xl text-white/70">
			Answer as many as you can before the clock runs out. Correct answers build your streak; one
			miss resets it. Explanations wait for you in the results.
		</p>
		{#if run.best}
			<p class="mt-4 text-sm font-semibold tracking-wider text-white/60 uppercase">
				Personal best: {run.best.score} correct · streak {run.best.bestStreak}
			</p>
		{/if}
		<p class="mt-3 text-sm">
			<a
				href="/leaderboard"
				class="inline-flex min-h-11 items-center text-white/70 underline decoration-white/30 underline-offset-2 hover:text-white"
			>
				See the leaderboard →
			</a>
		</p>
		{#if run.errorMessage}
			<p class="mt-4 text-sm font-semibold text-cardinal" role="alert">{run.errorMessage}</p>
		{/if}
		<button
			type="button"
			disabled={run.loadingBank}
			onclick={() => run.start()}
			class="mt-8 rounded-full bg-cardinal px-8 py-3 text-sm font-semibold tracking-wider text-white uppercase hover:brightness-110 disabled:opacity-40"
		>
			{run.loadingBank ? 'Loading…' : 'Start'}
		</button>
	{:else if run.phase === 'running'}
		<div
			class="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl bg-navy px-5 py-3"
		>
			<p class="font-mono text-3xl font-bold {run.timeLeft <= 10 ? 'text-cardinal' : 'text-white'}">
				{Math.floor(run.timeLeft / 60)}:{String(run.timeLeft % 60).padStart(2, '0')}
			</p>
			<button
				type="button"
				onclick={() => run.finish()}
				class="inline-flex min-h-11 items-center rounded-full border border-white/30 px-4 py-1.5 text-xs font-semibold tracking-wider whitespace-nowrap text-white/80 uppercase hover:border-white sm:order-last"
			>
				End run
			</button>
			<p
				class="order-last basis-full text-xs font-semibold tracking-wider whitespace-nowrap text-white/70 uppercase sm:order-none sm:basis-auto sm:text-sm"
			>
				Streak {run.streak} · Score {run.records.filter((r) => r.correct).length}
			</p>
		</div>
		<div class="mt-4">
			<QuestionPlayer
				items={run.items}
				rulesetId={DEFAULT_RULESET_ID}
				mode="rapid"
				onAnswer={(record) => run.onAnswer(record)}
				onComplete={() => run.finish()}
			/>
		</div>
	{:else}
		<h1 class="display mt-2 text-4xl text-white sm:text-5xl">Time!</h1>
		<div class="mt-8">
			<QuizSummary
				items={run.items}
				records={run.records}
				rulesetId={DEFAULT_RULESET_ID}
				heading="Timed challenge"
			>
				<p class="mt-3 text-sm font-semibold text-navy/70">
					Best streak this run: {run.bestStreak}
					{#if run.isNewBest}
						<span
							class="ml-2 rounded bg-turf px-2 py-0.5 text-xs font-bold tracking-wider text-white uppercase"
						>
							New personal best
						</span>
					{/if}
				</p>
				{#if run.claimedName}
					<p class="mt-2 text-sm text-navy/70">
						On the board as <b class="text-navy">{run.claimedName}</b> —
						<a
							href="/leaderboard"
							class="font-semibold text-cardinal underline decoration-cardinal/40 underline-offset-2 hover:decoration-cardinal"
							>see the leaderboard →</a
						>
					</p>
				{:else if run.nudge && !run.nudgeDismissed}
					<p class="mt-2 text-sm text-navy/70">
						#{run.nudge.rank} on the
						<a
							href="/leaderboard"
							class="font-semibold text-cardinal underline decoration-cardinal/40 underline-offset-2 hover:decoration-cardinal"
							>leaderboard</a
						>
						if you claim it —
						<DisplayNameClaim
							suggestion={run.nudge.suggestion}
							onSaved={(n) => (run.claimedName = n)}
						/>
						<button
							type="button"
							aria-label="Dismiss"
							onclick={() => (run.nudgeDismissed = true)}
							class="ml-1 inline-flex h-11 w-11 items-center justify-center text-navy/40 hover:text-navy/70"
							>✕</button
						>
					</p>
				{:else if run.myRank !== null}
					<p class="mt-2 text-sm text-navy/70">
						On the board at <b class="text-navy">#{run.myRank}</b> —
						<a
							href="/leaderboard"
							class="font-semibold text-cardinal underline decoration-cardinal/40 underline-offset-2 hover:decoration-cardinal"
							>see the leaderboard →</a
						>
					</p>
				{:else}
					<p class="mt-2 text-sm text-navy/70">
						<a
							href="/leaderboard"
							class="font-semibold text-cardinal underline decoration-cardinal/40 underline-offset-2 hover:decoration-cardinal"
							>See the leaderboard →</a
						>
					</p>
				{/if}
				<p class="mt-2 text-sm text-navy/60" role="status" aria-live="polite">
					{run.boardError ?? ''}
				</p>
				{#if run.errorMessage}
					<p class="mt-2 text-sm font-semibold text-cardinal" role="alert">{run.errorMessage}</p>
				{/if}
				<div class="mt-4 flex gap-3">
					<Button disabled={run.loadingBank} onclick={() => run.start()}>
						{run.loadingBank ? 'Loading…' : 'Run it back'}
					</Button>
					<Button variant="outline" href="/quiz">All modes</Button>
				</div>
			</QuizSummary>
		</div>
	{/if}
</section>
