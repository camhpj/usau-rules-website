<script lang="ts">
	import { DEFAULT_RULESET_ID } from '$lib/content/config';
	import GridPulses from '$lib/components/GridPulses.svelte';
</script>

<svelte:head><title>Best Perspective — USA Ultimate Rules</title></svelte:head>

<div class="relative overflow-hidden">
	<!-- decorative light pulses along the field grid -->
	<GridPulses />

	<!-- disc flight: launch rings, retracting comet tail, layered disc (art derived from static/icons/frisbee-favicon.svg) -->
	<!--
		SMIL choreography: Chromium never fires cross-element `X.begin` syncbase
		references, but `X.end` works — PROVIDED the referenced id has no hyphen.
		A hyphenated id (e.g. the old "disc-flight-anim") makes every `id.end`
		reference silently fail to resolve in Chromium, so any animation that
		depends on it never begins and just sits frozen at its prior value;
		keep this id, and any other id used in a begin/end time-value,
		camelCase-only. Flight-start animations use literal begin
		lists in lockstep with discFlightAnim's own "2.3s; discFlightAnim.end + 15.5s"
		(second launch ring +0.15s by design). The trail's opacity <set> window is
		2.5s (the flight); its dasharray hold <set> is 2.1s, overlapping the 0.5s
		absorption shrink that ends at touchdown. After landing, only
		the disc's 0.3s settle-and-fade runs: its animateMotion and first opacity
		animate are fill="freeze" so it stays put and visible at the landing point,
		then a second opacity animate (begin="discFlightAnim.end") holds it solid
		briefly before fading it out.
	-->
	<!-- below sm, cards stack and their opaque background covers the vertically-
		 centered flight path entirely, hiding the animation; anchor it small and
		 high (in the gap above the h1) instead. At sm+ cards go two-column and
		 free up the middle of the hero, so the original centered placement returns. -->
	<svg
		aria-hidden="true"
		class="disc-flight pointer-events-none absolute top-4 left-1/2 w-[48vw] -translate-x-1/2 sm:top-1/2 sm:w-[min(56rem,92vw)] sm:-translate-y-1/2"
		viewBox="0 0 800 400"
		fill="none"
	>
		<defs>
			<!-- pathLength normalizes the trail dashoffset math below; it must live on this
				 source path, not on the <use> elements that reference it — Chromium only
				 honors pathLength for dash calculations on the actual geometry element. -->
			<path id="disc-path" pathLength="1" d="M 40 340 C 240 120, 560 80, 760 200" />
			<!-- reversed copy: dash windows anchor at the pattern origin, so the tail's
				 disc-side edge is the anchored one here and shrinking the dash length
				 absorbs the tail from its far end (used by the comet tail below) -->
			<path id="disc-path-rev" pathLength="1" d="M 760 200 C 560 80, 240 120, 40 340" />
		</defs>

		<!-- launch rings -->
		<circle cx="40" cy="340" r="3" stroke="var(--color-cardinal)" stroke-width="2" opacity="0">
			<animate
				attributeName="r"
				values="3;22"
				dur="0.7s"
				begin="2.3s; discFlightAnim.end + 15.5s"
			/>
			<animate
				attributeName="opacity"
				values="0.8;0"
				dur="0.7s"
				begin="2.3s; discFlightAnim.end + 15.5s"
			/>
		</circle>
		<circle cx="40" cy="340" r="3" stroke="var(--color-cardinal)" stroke-width="1.5" opacity="0">
			<animate
				attributeName="r"
				values="3;22"
				dur="0.7s"
				begin="2.45s; discFlightAnim.end + 15.65s"
			/>
			<animate
				attributeName="opacity"
				values="0.6;0"
				dur="0.7s"
				begin="2.45s; discFlightAnim.end + 15.65s"
			/>
		</circle>

		<!-- comet tail: finite trail (0.35 of the path) that follows the disc and is
			 absorbed into it over the final 0.5s of flight — no post-landing tail
			 phase, so the landing reads as one continuous motion. Drawn on the
			 REVERSED path so the dash window's anchored edge sits at the disc.
			 Dash period stays 2.0 (wrap-safe). -->
		<use
			href="#disc-path-rev"
			stroke="white"
			stroke-opacity="0.3"
			stroke-width="2"
			stroke-linecap="round"
			stroke-dasharray="0 2"
			stroke-dashoffset="-1"
			opacity="0"
		>
			<!-- holds the working tail length through the pre-absorption flight; overlaps
				 the shrink animate by 0.1s so neither handoff edge can flash the base value.
				 NB: a zero-length dash with round linecaps renders as a DOT, not nothing —
				 the base "0 2" state is safe because that dot always sits under the launch
				 rings (offset −1) or the still-visible disc (offset 0), not because it is
				 truly invisible -->
			<set
				attributeName="stroke-dasharray"
				to="0.35 1.65"
				begin="2.3s; discFlightAnim.end + 15.5s"
				dur="2.1s"
			/>
			<set attributeName="opacity" to="1" begin="2.3s; discFlightAnim.end + 15.5s" dur="2.5s" />
			<animate
				attributeName="stroke-dashoffset"
				from="-1"
				to="0"
				dur="2.5s"
				begin="2.3s; discFlightAnim.end + 15.5s"
				calcMode="spline"
				keyTimes="0;1"
				keySplines="0.4 0 0.6 1"
				fill="freeze"
			/>
			<!-- absorption: shrink the tail to zero across the last 0.5s of flight
				 (begins at flight start + 2.0s, ends exactly at touchdown). fill is
				 the default "remove": the base dasharray is restored after landing,
				 safely under the closed opacity window above -->
			<animate
				attributeName="stroke-dasharray"
				from="0.35 1.65"
				to="0 2"
				dur="0.5s"
				begin="4.3s; discFlightAnim.end + 17.5s"
				calcMode="spline"
				keyTimes="0;1"
				keySplines="0.4 0 0.6 1"
			/>
		</use>

		<!-- disc -->
		<g opacity="0">
			<!-- fill="freeze" holds the disc at the landing point through its 0.3s
				 settle-and-fade instead of snapping back to the path origin the
				 instant this 2.5s motion ends -->
			<animateMotion
				id="discFlightAnim"
				dur="2.5s"
				begin="2.3s; discFlightAnim.end + 15.5s"
				calcMode="spline"
				keyPoints="0;1"
				keyTimes="0;1"
				keySplines="0.4 0 0.6 1"
				fill="freeze"
			>
				<mpath href="#disc-path" />
			</animateMotion>
			<!-- fade in, then hold visible through the end of flight; freeze carries
				 "1" into the collapse phase below instead of reverting to the base 0 -->
			<animate
				attributeName="opacity"
				values="0;1;1"
				keyTimes="0;0.06;1"
				dur="2.5s"
				begin="2.3s; discFlightAnim.end + 15.5s"
				fill="freeze"
			/>
			<!-- collapse phase: stay fully visible while the tail shrinks toward the
				 disc, then fade quickly once the tail has caught up -->
			<animate
				attributeName="opacity"
				values="1;1;0"
				keyTimes="0;0.4;1"
				dur="0.3s"
				begin="discFlightAnim.end"
				fill="freeze"
			/>
			<g>
				<animateTransform
					attributeName="transform"
					type="scale"
					values="0.3;1"
					dur="0.3s"
					begin="2.3s; discFlightAnim.end + 15.5s"
					fill="freeze"
				/>
				<g transform="rotate(-12)">
					<g class="disc-body">
						<ellipse cx="0" cy="1.6" rx="12" ry="5" fill="#7d1528" />
						<ellipse cx="0" cy="0" rx="12" ry="5" fill="var(--color-cardinal)" />
						<ellipse
							cx="0"
							cy="0"
							rx="7.5"
							ry="3"
							fill="none"
							stroke="#8f1a30"
							stroke-width="1.2"
						/>
						<path
							d="M -10 -1.8 A 12 5 0 0 1 10 -1.8"
							fill="none"
							stroke="#f2a9b4"
							stroke-width="1.2"
							stroke-linecap="round"
							opacity="0.75"
						/>
					</g>
				</g>
			</g>
		</g>
	</svg>

	<section
		class="relative mx-auto flex min-h-[calc(100vh-4rem-4.5rem)] max-w-6xl flex-col items-center justify-center px-4 py-12 text-center sm:px-6"
	>
		<h1 class="display animate-fade-up mt-5 text-[clamp(3.5rem,8vw,6.5rem)] text-white">
			Know the<br /><span class="text-cardinal">Rules.</span>
		</h1>
		<p class="animate-fade-up mt-5 mb-3 max-w-xl text-lg text-white/70" style="--stagger: 1">
			Learn the rules of Ultimate and test your knowledge.
		</p>

		<div class="mt-4 grid w-full max-w-3xl gap-4 text-left sm:grid-cols-2">
			<a
				href="/rules/{DEFAULT_RULESET_ID}"
				class="group animate-fade-up relative card card-link p-6"
				style="--stagger: 2"
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
				class="group animate-fade-up relative card card-link p-6"
				style="--stagger: 3"
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

		<a
			href="/ask"
			class="animate-fade-up mt-6 inline-flex items-center gap-2 text-sm text-white/60 hover:text-white"
			style="--stagger: 4"
		>
			<span aria-hidden="true" class="text-cardinal">✦</span> Ask any question
		</a>
	</section>
</div>
