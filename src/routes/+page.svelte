<script lang="ts">
	import GridPulses from '$lib/components/GridPulses.svelte';
	import PromoCard from '$lib/components/PromoCard.svelte';
</script>

<svelte:head><title>Best Perspective — USA Ultimate Rules</title></svelte:head>

<div class="home-fill relative flex flex-1 flex-col overflow-hidden">
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
	<!-- The flight is decorative and needs room: below sm the cards stack and their
		 opaque background covers the middle of the hero, and the only clear band left
		 is too short for the arc to read at any useful size. Hide it there rather than
		 shrink it into a speck, and let the hero fit a phone screen instead. -->
	<svg
		aria-hidden="true"
		class="disc-flight pointer-events-none absolute top-1/2 left-1/2 hidden w-[min(56rem,92vw)] -translate-x-1/2 -translate-y-1/2 sm:block"
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
		class="relative mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center px-4 py-3 text-center sm:px-6 sm:py-12"
	>
		<h1 class="display animate-fade-up mt-4 text-[clamp(3rem,8vw,6.5rem)] text-white sm:mt-5">
			Know the<br /><span class="text-cardinal">Rules.</span>
		</h1>
		<p
			class="animate-fade-up mt-3 mb-1 max-w-xl text-base text-white/70 sm:mt-5 sm:mb-3 sm:text-lg"
		>
			Learn the rules of Ultimate and test your knowledge.
		</p>

		<div class="mt-3 grid w-full max-w-3xl gap-2 text-left sm:mt-4 sm:grid-cols-2 sm:gap-4">
			<PromoCard href="/rules">
				<h2 class="display text-2xl">Explore the rules</h2>
				<p class="mt-1 pr-8 text-sm text-navy/70 sm:mt-1.5">
					The whole rule book in a readable and searchable format.
				</p>
			</PromoCard>
			<PromoCard href="/quiz">
				<h2 class="display text-2xl">Test yourself</h2>
				<p class="mt-1 pr-8 text-sm text-navy/70 sm:mt-1.5">
					Quick quizzes, game scenarios, and section mastery grounded with citations.
				</p>
			</PromoCard>
		</div>

		<!-- One link, styled two ways: a line of copy on desktop, where the hero has
			 room for it, and a pill on a phone, where a bare line of small grey text is
			 easy to miss under two full-width cards. It stays in the flow rather than
			 floating, so it cannot come to rest on a card or the footer — between them
			 those two cover every position a floating button had to choose from. -->
		<a
			href="/ask"
			class="animate-fade-up mt-3 inline-flex min-h-11 items-center gap-2 text-sm text-white/70 hover:text-white max-sm:rounded-full max-sm:border max-sm:border-white/20 max-sm:px-4 sm:mt-6 sm:text-white/60"
		>
			<!-- sized in em so it tracks the label, and drawn rather than typed: the ✦
				 glyph centres on font metrics, which left it visibly off-centre. -->
			<svg
				aria-hidden="true"
				class="h-[1.35em] w-[1.35em] shrink-0 text-cardinal"
				viewBox="0 0 24 24"
				fill="currentColor"
			>
				<path d="M12 1 Q13.2 10.8 23 12 Q13.2 13.2 12 23 Q10.8 13.2 1 12 Q10.8 10.8 12 1 Z" />
			</svg>
			Ask any question
		</a>
	</section>
</div>
