<script lang="ts">
	import { ScenarioResponseSchema } from '$lib/ai/payload';
	import { createSessionGate } from '$lib/auth-gate.svelte';
	import Button from '$lib/components/Button.svelte';
	import SignInCard from '$lib/components/SignInCard.svelte';
	import QuestionPlayer from '$lib/components/quiz/QuestionPlayer.svelte';
	import { DEFAULT_RULESET_ID } from '$lib/content/config';
	import { buildQuizItems, mulberry32, type QuizItem } from '$lib/quiz/engine';
	import { DIFFICULTY_LABELS } from '$lib/quiz/types';

	const DIFFICULTIES = [1, 2, 3] as const;

	const gate = createSessionGate();

	let difficulty = $state<1 | 2 | 3 | null>(null);
	let phase = $state<'setup' | 'loading' | 'playing' | 'done'>('setup');
	let items = $state<QuizItem[]>([]);
	let source = $state<'ai' | 'fallback'>('ai');
	let remaining = $state<number | null>(null);
	let errorMessage = $state<string | null>(null);

	async function deal() {
		phase = 'loading';
		errorMessage = null;
		try {
			const res = await fetch('/api/ai/scenario', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(difficulty ? { difficulty } : {})
			});
			if (!res.ok) {
				errorMessage =
					res.status === 429
						? ((await res.json().catch(() => null))?.message ??
							'Daily limit reached — try again tomorrow.')
						: res.status === 503
							? 'AI features are offline right now — try a bank quiz instead.'
							: res.status === 401
								? 'Your session expired — sign in again.'
								: 'Something went wrong — try again in a minute.';
				phase = 'setup';
				return;
			}
			const parsed = ScenarioResponseSchema.safeParse(await res.json().catch(() => null));
			if (!parsed.success) {
				errorMessage = 'Got a malformed scenario — try again.';
				phase = 'setup';
				return;
			}
			source = parsed.data.source;
			remaining = parsed.data.remaining;
			items = buildQuizItems([parsed.data.question], mulberry32(Date.now()));
			phase = 'playing';
		} catch {
			errorMessage = 'Network error — try again.';
			phase = 'setup';
		}
	}
</script>

<svelte:head><title>Scenario mode · Best Perspective</title></svelte:head>

<section class="mx-auto max-w-3xl px-4 py-10 sm:px-6">
	<p class="eyebrow text-cardinal">Scenario mode</p>
	<h1 class="display mt-2 text-4xl text-white sm:text-5xl">Make the call.</h1>

	{#if !gate.sessionReady}
		<div class="mt-8 h-40 animate-pulse rounded-xl bg-white/10" aria-hidden="true"></div>
	{:else if !gate.user}
		<SignInCard heading="Sign in to play scenarios" onclick={() => gate.signIn('/quiz/scenario')} />
	{:else if phase === 'setup' || phase === 'loading'}
		<div class="card mt-8 p-6 sm:p-8">
			<h2 class="eyebrow text-navy/50">Difficulty</h2>
			<div class="mt-3 flex flex-wrap gap-2">
				<button
					type="button"
					aria-pressed={difficulty === null}
					onclick={() => (difficulty = null)}
					class="rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors
						{difficulty === null
						? 'border-navy bg-navy text-white'
						: 'border-mist text-navy/70 hover:border-navy/40'}"
				>
					Any
				</button>
				{#each DIFFICULTIES as d (d)}
					<button
						type="button"
						aria-pressed={difficulty === d}
						onclick={() => (difficulty = d)}
						class="rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors
							{difficulty === d
							? 'border-navy bg-navy text-white'
							: 'border-mist text-navy/70 hover:border-navy/40'}"
					>
						{d} · {DIFFICULTY_LABELS[d]}
					</button>
				{/each}
			</div>
			{#if errorMessage}
				<p class="mt-4 text-sm font-semibold text-cardinal" role="alert">{errorMessage}</p>
			{/if}
			<div class="mt-8 flex items-center justify-between border-t border-mist pt-5">
				<p class="text-sm text-navy/60">
					{#if phase === 'loading'}
						Dealing a scenario…
					{:else if remaining !== null}
						{remaining} scenario{remaining === 1 ? '' : 's'} left today
					{:else}
						Generate a realistic game scenario and make the call.
					{/if}
				</p>
				<Button disabled={phase === 'loading'} onclick={deal}>Deal a scenario</Button>
			</div>
		</div>
	{:else if phase === 'playing'}
		<div class="mt-8">
			{#if source === 'fallback'}
				<p class="mb-3 text-sm text-white/70">
					AI was unavailable — this one is from the question bank.
				</p>
			{/if}
			<!-- Scenario answers are ephemeral by design: AI question ids are unknown to the
			     bank, so they are neither written to local mastery history nor synced. -->
			<QuestionPlayer
				{items}
				rulesetId={DEFAULT_RULESET_ID}
				finishLabel="Continue"
				onComplete={() => (phase = 'done')}
			/>
		</div>
	{:else}
		<div class="card mt-8 p-8">
			<h2 class="display text-2xl">Nice call.</h2>
			{#if remaining !== null}
				<p class="mt-2 text-sm text-navy/60">
					{remaining} scenario{remaining === 1 ? '' : 's'} left today.
				</p>
			{/if}
			<div class="mt-6 flex gap-3">
				<Button onclick={deal}>Another scenario</Button>
				<Button variant="outline" onclick={() => (phase = 'setup')}>Change difficulty</Button>
			</div>
		</div>
	{/if}
</section>
