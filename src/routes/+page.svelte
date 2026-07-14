<script lang="ts">
	import { DEFAULT_RULESET_ID } from '$lib/content/config';
</script>

<svelte:head><title>Best Perspective — USA Ultimate Rules</title></svelte:head>

<section
	class="mx-auto flex min-h-[calc(100vh-4rem-4.5rem)] max-w-6xl flex-col items-center justify-center px-4 py-12 text-center sm:px-6"
>
	<h1 class="display mt-5 text-[clamp(3.5rem,8vw,6.5rem)] text-white">
		Know the<br /><span class="text-cardinal">Rules.</span>
	</h1>
	<p class="mt-5 mb-3 max-w-xl text-lg text-white/70">
		Learn the rules of Ultimate and test your knowledge.
	</p>

	<div class="mt-4 grid w-full max-w-3xl gap-4 text-left sm:grid-cols-2">
		<a
			href="/rules/{DEFAULT_RULESET_ID}"
			class="group relative card card-link p-6"
		>
			<h2 class="display text-2xl">Explore the rules</h2>
			<p class="mt-1.5 pr-8 text-sm text-navy/70">
				The whole rule book in a readable and searchable format.
			</p>
			<span
				aria-hidden="true"
				class="absolute top-6 right-6 inline-flex h-8 w-8 items-center justify-center rounded-full bg-cardinal text-white transition-transform group-hover:translate-x-1"
				>→</span
			>
		</a>
		<a
			href="/quiz"
			class="group relative card card-link p-6"
		>
			<h2 class="display text-2xl">Test yourself</h2>
			<p class="mt-1.5 pr-8 text-sm text-navy/70">
				Quick quizzes, game scenarios, and section mastery grounded with citations.
			</p>
			<span
				aria-hidden="true"
				class="absolute top-6 right-6 inline-flex h-8 w-8 items-center justify-center rounded-full bg-cardinal text-white transition-transform group-hover:translate-x-1"
				>→</span
			>
		</a>
	</div>

	<a href="/ask" class="mt-6 inline-flex items-center gap-2 text-sm text-white/60 hover:text-white">
		<span aria-hidden="true" class="text-cardinal">✦</span> Ask any question
	</a>
</section>
