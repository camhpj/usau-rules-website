<script lang="ts">
	import { onMount } from 'svelte';
	import { ScenarioResponseSchema } from '$lib/ai/payload';
	import { authClient } from '$lib/auth-client';
	import QuestionPlayer from '$lib/components/quiz/QuestionPlayer.svelte';
	import { DEFAULT_RULESET_ID } from '$lib/content/config';
	import { buildQuizItems, mulberry32, type QuizItem } from '$lib/quiz/engine';
	import { DIFFICULTY_LABELS } from '$lib/quiz/types';

	const DIFFICULTIES = [1, 2, 3] as const;

	let user = $state<{ name: string } | null>(null);
	let sessionReady = $state(false);
	let difficulty = $state<1 | 2 | 3 | null>(null);
	let phase = $state<'setup' | 'loading' | 'playing' | 'done'>('setup');
	let items = $state<QuizItem[]>([]);
	let source = $state<'ai' | 'fallback'>('ai');
	let remaining = $state<number | null>(null);
	let errorMessage = $state<string | null>(null);

	onMount(() => {
		const store = authClient.useSession();
		return store.subscribe((s) => {
			user = s.data?.user ?? null;
			if (!s.isPending) sessionReady = true;
		});
	});

	function signIn() {
		void authClient.signIn.social({ provider: 'google', callbackURL: '/quiz/scenario' });
	}

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
	<p class="text-xs font-semibold tracking-[0.18em] text-cardinal uppercase">Scenario mode</p>
	<h1 class="display mt-2 text-4xl text-white sm:text-5xl">Make the call.</h1>

	{#if !sessionReady}
		<div class="mt-8 h-40 animate-pulse rounded-xl bg-white/10" aria-hidden="true"></div>
	{:else if !user}
		<div class="card mt-8 p-8 text-center">
			<h2 class="display text-2xl">Sign in to play scenarios</h2>
			<button
				type="button"
				onclick={signIn}
				class="mt-6 rounded-full bg-cardinal px-6 py-2.5 text-sm font-semibold tracking-wider text-white uppercase hover:brightness-110"
			>
				Sign in with Google
			</button>
		</div>
	{:else if phase === 'setup' || phase === 'loading'}
		<div class="card mt-8 p-6 sm:p-8">
			<h2 class="text-xs font-semibold tracking-[0.18em] text-navy/50 uppercase">Difficulty</h2>
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
				<button
					type="button"
					disabled={phase === 'loading'}
					onclick={deal}
					class="rounded-full bg-cardinal px-6 py-2.5 text-sm font-semibold tracking-wider text-white uppercase hover:brightness-110 disabled:opacity-40"
				>
					Deal a scenario
				</button>
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
				<button
					type="button"
					onclick={deal}
					class="rounded-full bg-cardinal px-6 py-2.5 text-sm font-semibold tracking-wider text-white uppercase hover:brightness-110"
				>
					Another scenario
				</button>
				<button
					type="button"
					onclick={() => (phase = 'setup')}
					class="rounded-full border border-navy/30 px-6 py-2.5 text-sm font-semibold tracking-wider text-navy uppercase hover:border-navy"
				>
					Change difficulty
				</button>
			</div>
		</div>
	{/if}
</section>
