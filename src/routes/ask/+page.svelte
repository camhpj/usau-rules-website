<script lang="ts">
	import { onMount } from 'svelte';
	import { ASK_MAX_PROMPT_CHARS } from '$lib/ai/payload';
	import { latestThoughtHeadline } from '$lib/ai/thoughts';
	import { authClient } from '$lib/auth-client';
	import { segmentCitations } from '$lib/content/citations';
	import { DEFAULT_RULESET_ID } from '$lib/content/config';
	import { ruleIdSet } from '$lib/content/rule-id-sets';
	import { sectionSlugForRuleId } from '$lib/content/rule-ids';

	const ruleIds = ruleIdSet(DEFAULT_RULESET_ID);

	let user = $state<{ name: string } | null>(null);
	let sessionReady = $state(false);
	let question = $state('');
	let answer = $state('');
	let thoughts = $state('');
	let phase = $state<'idle' | 'streaming' | 'done'>('idle');
	let errorMessage = $state<string | null>(null);
	let remaining = $state<number | null>(null);

	const thoughtHeadline = $derived(latestThoughtHeadline(thoughts));

	onMount(() => {
		const store = authClient.useSession();
		return store.subscribe((s) => {
			user = s.data?.user ?? null;
			if (!s.isPending) sessionReady = true;
		});
	});

	const segments = $derived(segmentCitations(answer, ruleIds));

	function refHref(id: string): string | null {
		const slug = sectionSlugForRuleId(id);
		return slug ? `/rules/${DEFAULT_RULESET_ID}/${slug}#${encodeURIComponent(id)}` : null;
	}

	function signIn() {
		void authClient.signIn.social({ provider: 'google', callbackURL: '/ask' });
	}

	async function submit(event?: SubmitEvent) {
		event?.preventDefault();
		const prompt = question.trim();
		if (!prompt || phase === 'streaming') return;
		phase = 'streaming';
		answer = '';
		thoughts = '';
		errorMessage = null;
		try {
			const res = await fetch('/api/ai/ask', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ prompt })
			});
			if (!res.ok || !res.body) {
				errorMessage =
					res.status === 429
						? ((await res.json().catch(() => null))?.message ??
							'Daily limit reached — try again tomorrow.')
						: res.status === 503
							? 'AI features are offline right now.'
							: res.status === 401
								? 'Your session expired — sign in again.'
								: 'The rules assistant is unavailable — try again in a minute.';
				phase = 'idle';
				return;
			}
			const header = res.headers.get('x-bp-ai-remaining');
			if (header !== null) remaining = Number(header);
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let lineBuffer = '';
			const handleLine = (line: string) => {
				if (!line) return;
				let msg: { t?: string; text?: string };
				try {
					msg = JSON.parse(line);
				} catch {
					return;
				}
				if (msg.t === 'think') thoughts += msg.text ?? '';
				else if (msg.t === 'text') answer += msg.text ?? '';
				else if (msg.t === 'truncated')
					errorMessage = 'The answer was cut short — try asking again.';
			};
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				lineBuffer += decoder.decode(value, { stream: true });
				let newline: number;
				while ((newline = lineBuffer.indexOf('\n')) !== -1) {
					handleLine(lineBuffer.slice(0, newline));
					lineBuffer = lineBuffer.slice(newline + 1);
				}
			}
			lineBuffer += decoder.decode();
			handleLine(lineBuffer);
			if (!answer.trim()) {
				errorMessage = 'No answer came back — try again.';
				phase = 'idle';
				return;
			}
			phase = 'done';
		} catch {
			errorMessage = answer
				? 'The connection dropped mid-answer — what arrived is shown above.'
				: 'Network error — try again.';
			phase = answer ? 'done' : 'idle';
		}
	}

	function onQuestionKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter') return;
		// Cmd/Ctrl+Enter inserts a newline (a bare textarea would do nothing);
		// Shift+Enter keeps its native newline; bare Enter submits.
		if (event.metaKey || event.ctrlKey) {
			event.preventDefault();
			const el = event.currentTarget as HTMLTextAreaElement;
			el.setRangeText('\n', el.selectionStart, el.selectionEnd, 'end');
			question = el.value;
			return;
		}
		if (event.shiftKey) return;
		event.preventDefault();
		void submit();
	}
</script>

<svelte:head><title>Ask · Best Perspective</title></svelte:head>

<section class="mx-auto max-w-3xl px-4 py-10 sm:px-6">
	{#if !sessionReady}
		<div class="mt-8 h-40 animate-pulse rounded-xl bg-white/10" aria-hidden="true"></div>
	{:else if !user}
		<div class="card mt-8 p-8 text-center">
			<h2 class="display text-2xl">Sign in to use the ask feature</h2>
			<button
				type="button"
				onclick={signIn}
				class="mt-6 rounded-full bg-cardinal px-6 py-2.5 text-sm font-semibold tracking-wider text-white uppercase hover:brightness-110"
			>
				Sign in with Google
			</button>
		</div>
	{:else}
		<form onsubmit={submit} class="card mt-8 p-6 sm:p-8">
			<label for="ask-input" class="text-xs font-semibold tracking-[0.18em] text-navy/50 uppercase">
				Your question
			</label>
			<textarea
				id="ask-input"
				bind:value={question}
				onkeydown={onQuestionKeydown}
				maxlength={ASK_MAX_PROMPT_CHARS}
				rows="3"
				placeholder="e.g. What happens when the disc hits a tree branch over the field?"
				class="mt-3 w-full resize-none rounded-lg border border-mist p-3 text-sm focus:border-navy/50 focus:outline-none"
			></textarea>
			{#if errorMessage}
				<p class="mt-4 text-sm font-semibold text-cardinal" role="alert">{errorMessage}</p>
			{/if}
			<div class="mt-6 flex items-center justify-between border-t border-mist pt-5">
				<p class="text-xs text-navy/50">
					{#if remaining !== null}
						{remaining} question{remaining === 1 ? '' : 's'} left today
					{:else}
						Ask is powered by AI which can make mistakes.
					{/if}
				</p>
				<button
					type="submit"
					disabled={phase === 'streaming' || question.trim().length < 3}
					class="rounded-full bg-cardinal px-6 py-2.5 text-sm font-semibold tracking-wider text-white uppercase hover:brightness-110 disabled:opacity-40"
				>
					Ask
				</button>
			</div>
		</form>

		{#if answer || phase === 'streaming'}
			<div class="card mt-6 p-6 sm:p-8">
				<h2 class="text-xs font-semibold tracking-[0.18em] text-navy/50 uppercase">Answer</h2>
				{#if phase === 'streaming' && !answer}
					<p class="mt-3 flex items-center gap-2 text-sm text-navy/50 italic">
						<span
							class="inline-block h-2 w-2 animate-pulse rounded-full bg-cardinal/60"
							aria-hidden="true"
						></span>
						{thoughtHeadline ? `Thinking — ${thoughtHeadline}` : 'Thinking…'}
					</p>
				{:else}
					<p class="mt-3 text-[15px] leading-relaxed whitespace-pre-wrap">
						{#each segments as segment, i (i)}
							{#if segment.type === 'text'}{segment.text}{:else}
								{@const link = refHref(segment.anchorId)}
								{#if link}
									<a
										href={link}
										target="_blank"
										rel="noopener"
										title="Open rule {segment.anchorId} in the explorer"
										class="font-mono text-[13px] font-semibold text-cardinal underline decoration-cardinal/40 underline-offset-2 hover:decoration-cardinal"
										>{segment.id}</a
									>
								{:else}<span class="font-mono text-[13px] font-semibold">{segment.id}</span>{/if}
							{/if}
						{/each}{#if phase === 'streaming'}<span
								class="ml-0.5 inline-block h-4 w-2 animate-pulse bg-cardinal/60"
								aria-hidden="true"
							></span>{/if}
					</p>
				{/if}
			</div>
		{/if}
	{/if}
</section>
