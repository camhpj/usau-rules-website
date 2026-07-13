import { error, redirect } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { DEFAULT_RULESET_ID } from '$lib/content/config';
import { getManifest } from '$lib/content/manifests';
import { sectionSlugForRuleId } from '$lib/content/rule-ids';
import { questionCountsBySection } from '$lib/quiz/bank';
import { computeSectionMastery } from '$lib/quiz/mastery';
import { bookmarks, questionResponses, quizAttempts, user } from '$lib/server/db/schema';
import { suggestDisplayName } from '$lib/server/profile/display-name';

export const prerender = false;

const MAX_RESPONSES = 2000;

export const load: PageServerLoad = async (event) => {
	// Guard against requests where hooks had no platform bindings available.
	if (!event.locals.auth) error(503, 'auth unavailable');
	const session = await event.locals.auth.api.getSession({ headers: event.request.headers });
	if (!session) redirect(303, '/');
	const userId = session.user.id;
	const db = event.locals.db;
	const rulesetId = DEFAULT_RULESET_ID;
	const manifest = getManifest(rulesetId);
	const sectionBySlug = new Map(manifest.sections.map((s) => [s.slug, s]));

	const [attemptRows, responseRows, bestRows, bookmarkRows, profileRows] = await Promise.all([
		db
			.select()
			.from(quizAttempts)
			.where(and(eq(quizAttempts.userId, userId), eq(quizAttempts.rulesetId, rulesetId)))
			.orderBy(desc(quizAttempts.createdAt))
			.limit(20),
		db
			.select({
				questionId: questionResponses.questionId,
				sectionSlug: questionResponses.sectionSlug,
				correct: questionResponses.correct,
				at: questionResponses.at
			})
			.from(questionResponses)
			.where(and(eq(questionResponses.userId, userId), eq(questionResponses.rulesetId, rulesetId)))
			.orderBy(desc(questionResponses.at), desc(questionResponses.id))
			.limit(MAX_RESPONSES),
		db
			.select({
				score: quizAttempts.score,
				bestStreak: quizAttempts.bestStreak,
				createdAt: quizAttempts.createdAt
			})
			.from(quizAttempts)
			.where(
				and(
					eq(quizAttempts.userId, userId),
					eq(quizAttempts.rulesetId, rulesetId),
					eq(quizAttempts.mode, 'timed')
				)
			)
			.orderBy(desc(quizAttempts.score), desc(quizAttempts.bestStreak))
			.limit(1),
		db
			.select({
				rulesetId: bookmarks.rulesetId,
				ruleId: bookmarks.ruleId,
				createdAt: bookmarks.createdAt
			})
			.from(bookmarks)
			.where(eq(bookmarks.userId, userId))
			.orderBy(desc(bookmarks.createdAt)),
		db
			.select({ displayName: user.displayName, name: user.name })
			.from(user)
			.where(eq(user.id, userId))
			.limit(1)
	]);

	const responses = responseRows.reverse(); // chronological for computeSectionMastery
	const counts = questionCountsBySection(rulesetId);
	const mastery = manifest.sections
		.filter((s) => (counts.get(s.slug) ?? 0) > 0)
		.map((s) => {
			const m = computeSectionMastery(responses, s.slug);
			return {
				sectionSlug: s.slug,
				number: s.number,
				title: s.title,
				level: m.level,
				recentPct: m.recentPct,
				attempts: m.attempts
			};
		});

	const best = bestRows[0];
	return {
		now: Date.now(),
		user: {
			name: session.user.name,
			email: session.user.email,
			image: session.user.image ?? null
		},
		rulesetId,
		attempts: attemptRows.map((a) => ({
			id: a.id,
			mode: a.mode,
			sectionTitle: a.sectionSlug ? (sectionBySlug.get(a.sectionSlug)?.title ?? null) : null,
			score: a.score,
			total: a.total,
			durationS: a.durationS,
			createdAt: a.createdAt
		})),
		mastery,
		timedBest: best
			? { score: best.score, bestStreak: best.bestStreak ?? 0, at: best.createdAt }
			: null,
		bookmarks: bookmarkRows.map((b) => {
			const slug = sectionSlugForRuleId(b.ruleId);
			return {
				...b,
				sectionSlug: slug,
				sectionTitle: slug ? (sectionBySlug.get(slug)?.title ?? null) : null
			};
		}),
		profile: {
			displayName: profileRows[0]?.displayName ?? null,
			suggestion: suggestDisplayName(profileRows[0]?.name ?? session.user.name ?? '')
		}
	};
};
