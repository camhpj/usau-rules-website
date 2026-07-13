<script lang="ts">
	import { onMount } from 'svelte';
	import {
		LEADERBOARD_SIZE,
		LeaderboardResponseSchema,
		type LeaderboardEntry,
		type LeaderboardResponse
	} from '$lib/leaderboard/payload';

	let board = $state<LeaderboardResponse | null>(null);
	let failed = $state(false);

	async function load() {
		failed = false;
		try {
			const res = await fetch('/api/leaderboard');
			const parsed = LeaderboardResponseSchema.safeParse(await res.json().catch(() => null));
			if (!res.ok || !parsed.success) {
				failed = true;
				return;
			}
			board = parsed.data;
		} catch {
			failed = true;
		}
	}

	onMount(() => {
		void load();
	});

	const dateLabel = (at: number) =>
		new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	const showMeRow = $derived(
		board?.me != null &&
			!board.entries.some(
				(e) => e.rank === board!.me!.rank && e.displayName === board!.me!.displayName
			)
	);

	// Always LEADERBOARD_SIZE rows total — placeholders fill open slots (and the
	// whole board while loading) so the card never changes height when data lands.
	// When the caller's own rank falls outside the top LEADERBOARD_SIZE, the pinned
	// "me" summary row (rendered after this list, see showMeRow below) needs a slot
	// of its own — reserve it by trimming the last visible entry, rather than
	// appending an 11th row that would grow the table only after load resolves.
	const rows = $derived<(LeaderboardEntry | null)[]>(
		board
			? (() => {
					const capacity = showMeRow ? LEADERBOARD_SIZE - 1 : LEADERBOARD_SIZE;
					const visible = board.entries.slice(0, capacity);
					return [...visible, ...Array(Math.max(0, capacity - visible.length)).fill(null)];
				})()
			: Array(LEADERBOARD_SIZE).fill(null)
	);
</script>

<svelte:head><title>Leaderboard · Best Perspective</title></svelte:head>

<section class="mx-auto max-w-3xl px-4 py-10 sm:px-6">
	<p class="text-xs font-semibold tracking-[0.18em] text-cardinal uppercase">Timed challenge</p>
	<h1 class="display mt-2 text-4xl text-white sm:text-5xl">Leaderboard.</h1>
	<p class="mt-3 max-w-xl text-white/70">
		The {LEADERBOARD_SIZE} best five-minute runs, server-verified. One entry per player.
	</p>

	<div class="mt-8 rounded-xl bg-white p-4 text-navy sm:p-6">
		{#if failed}
			<div class="py-10 text-center">
				<p class="text-sm text-navy/60">Couldn’t load the leaderboard.</p>
				<button
					type="button"
					onclick={load}
					class="mt-4 rounded-full border border-navy/30 px-5 py-2 text-xs font-semibold tracking-wider uppercase hover:border-navy"
				>
					Try again
				</button>
			</div>
		{:else}
			<table class="w-full table-fixed text-sm" class:animate-pulse={!board}>
				<thead>
					<tr class="text-left text-[10px] tracking-[0.14em] text-navy/50 uppercase">
						<th scope="col" class="w-10 px-2 py-2 sm:px-3">#</th>
						<th scope="col" class="px-2 py-2 sm:px-3">Player</th>
						<th scope="col" class="w-14 px-2 py-2 text-right sm:w-16 sm:px-3">Score</th>
						<th scope="col" class="w-14 px-2 py-2 text-right sm:w-16 sm:px-3">Streak</th>
						<th scope="col" class="hidden px-3 py-2 text-right sm:table-cell sm:w-20">When</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as entry, i (entry ? entry.displayName : `open-${i}`)}
						{#if entry}
							<tr class="border-t border-mist">
								<td
									class="px-2 py-2.5 font-mono font-bold sm:px-3 {entry.rank <= 3
										? 'text-cardinal'
										: 'text-navy'}">{entry.rank}</td
								>
								<td class="max-w-0 truncate px-2 py-2.5 sm:px-3">
									<span
										class="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-navy text-[10px] font-bold text-white"
										aria-hidden="true">{entry.displayName[0].toUpperCase()}</span
									>{entry.displayName}
								</td>
								<td class="px-2 py-2.5 text-right font-mono font-bold sm:px-3">{entry.score}</td>
								<td class="px-2 py-2.5 text-right font-mono sm:px-3">{entry.bestStreak}</td>
								<td class="hidden px-3 py-2.5 text-right text-navy/60 sm:table-cell"
									>{dateLabel(entry.at)}</td
								>
							</tr>
						{:else}
							<tr class="border-t border-mist text-navy/30">
								<td class="px-2 py-2.5 font-mono font-bold sm:px-3">{i + 1}</td>
								<td class="max-w-0 truncate px-2 py-2.5 sm:px-3">
									<!-- An empty inline-flex box synthesizes a different baseline than one with
										text in it (flexbox baseline-alignment), which made this row ~5px taller
										than a real entry's row — a shift in itself. The invisible glyph gives it
										the same text baseline as the real badge's initial letter, at zero visual
										cost (text-transparent). -->
									<span
										class="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-mist text-[10px] text-transparent"
										aria-hidden="true">·</span
									>—
								</td>
								<td class="px-2 py-2.5 text-right font-mono sm:px-3">—</td>
								<td class="px-2 py-2.5 text-right font-mono sm:px-3">—</td>
								<td class="hidden px-3 py-2.5 text-right sm:table-cell">—</td>
							</tr>
						{/if}
					{/each}
					{#if board && showMeRow && board.me}
						<tr class="rounded-lg bg-mist">
							<td class="px-2 py-2.5 font-mono font-bold sm:px-3">{board.me.rank}</td>
							<td class="max-w-0 truncate px-2 py-2.5 font-semibold sm:px-3">
								<span
									class="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-navy text-[10px] font-bold text-white"
									aria-hidden="true">{board.me.displayName[0].toUpperCase()}</span
								>You — {board.me.displayName}
							</td>
							<td class="px-2 py-2.5 text-right font-mono font-bold sm:px-3">{board.me.score}</td>
							<td class="px-2 py-2.5 text-right font-mono sm:px-3">{board.me.bestStreak}</td>
							<td class="hidden px-3 py-2.5 text-right text-navy/60 sm:table-cell"
								>{dateLabel(board.me.at)}</td
							>
						</tr>
					{/if}
				</tbody>
			</table>
			{#if board && board.entries.length === 0}
				<p class="mt-3 text-center text-sm text-navy/60">
					No runs on the board yet — set a name and play the timed challenge.
				</p>
			{/if}
		{/if}
	</div>

	<a
		href="/quiz/timed"
		class="mt-6 inline-block rounded-full bg-cardinal px-6 py-2.5 text-sm font-semibold tracking-wider text-white uppercase hover:brightness-110"
	>
		Play the timed challenge →
	</a>
</section>
