import { redirect } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { DEFAULT_RULESET_ID } from '$lib/content/config';
import { getManifest } from '$lib/content/manifests';
import { sectionSlugForRuleId } from '$lib/content/rule-ids';
import { questionCountsBySection } from '$lib/server/quiz/bank';
import {
	fetchBookmarks,
	fetchDisplayNameState,
	fetchResponseHistory,
	fetchTimedBest
} from '$lib/server/quiz/queries';
import { computeSectionMastery } from '$lib/quiz/mastery';
import { quizAttempts } from '$lib/server/db/schema';
import { requireAuth, requireDb } from '$lib/server/http';
import { suggestDisplayName } from '$lib/server/profile/display-name';

export const prerender = false;

export const load: PageServerLoad = async (event) => {
	const auth = requireAuth(event.locals);
	const session = await auth.api.getSession({ headers: event.request.headers });
	if (!session) redirect(303, '/');
	const userId = session.user.id;
	const db = requireDb(event.locals);
	const rulesetId = DEFAULT_RULESET_ID;
	const manifest = getManifest(rulesetId);
	const sectionBySlug = new Map(manifest.sections.map((s) => [s.slug, s]));

	const [attemptRows, responses, best, bookmarkRows, profile] = await Promise.all([
		db
			.select()
			.from(quizAttempts)
			.where(and(eq(quizAttempts.userId, userId), eq(quizAttempts.rulesetId, rulesetId)))
			.orderBy(desc(quizAttempts.createdAt))
			.limit(20),
		fetchResponseHistory(db, userId, rulesetId),
		fetchTimedBest(db, userId, rulesetId),
		fetchBookmarks(db, userId),
		fetchDisplayNameState(db, userId)
	]);

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
			displayName: profile?.displayName ?? null,
			suggestion: suggestDisplayName(profile?.name ?? session.user.name ?? '')
		}
	};
};
