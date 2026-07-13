import { z } from 'zod';

/** Wire shapes shared by the quiz pages, the sync outbox, and the /api handlers. */

export interface ResponsePayload {
	questionId: string;
	choiceIndex: number; // index into question.choices (original order, NOT display order)
	at: number; // epoch ms
}

export const ResponsePayloadSchema: z.ZodType<ResponsePayload> = z.object({
	questionId: z.string().min(1).max(64),
	choiceIndex: z.number().int().min(0).max(3),
	at: z.number().int().positive()
});

export const ATTEMPT_MAX_RESPONSES = 100;

export interface AttemptPayload {
	clientId: string;
	rulesetId: string;
	mode: 'quick' | 'mastery';
	sectionSlug: string | null;
	startedAt: number;
	durationS: number;
	responses: ResponsePayload[];
}

export const AttemptPayloadSchema: z.ZodType<AttemptPayload> = z.object({
	clientId: z.uuid(),
	rulesetId: z.string().min(1).max(64),
	mode: z.enum(['quick', 'mastery']),
	sectionSlug: z.string().min(1).max(64).nullable(),
	startedAt: z.number().int().positive(),
	durationS: z
		.number()
		.int()
		.min(0)
		.max(24 * 3600),
	responses: z.array(ResponsePayloadSchema).min(1).max(ATTEMPT_MAX_RESPONSES)
});

export const TIMED_DURATION_S = 300;
export const TIMED_GRACE_S = 20; // server-side slack for network + clock skew
export const TIMED_MAX_RESPONSES = 300; // ~1 answer/second ceiling, scaled to the duration

export interface TimedFinishPayload {
	token: string;
	rulesetId: string;
	responses: { questionId: string; choiceIndex: number }[]; // answer order matters (streak)
}

export const TimedFinishPayloadSchema: z.ZodType<TimedFinishPayload> = z.object({
	token: z.string().min(1).max(2048),
	rulesetId: z.string().min(1).max(64),
	responses: z
		.array(
			z.object({
				questionId: z.string().min(1).max(64),
				choiceIndex: z.number().int().min(0).max(3)
			})
		)
		.min(1)
		.max(TIMED_MAX_RESPONSES)
});

export interface SyncState {
	responses: { questionId: string; sectionSlug: string; correct: boolean; at: number }[];
	timedBest: { score: number; bestStreak: number; at: number } | null;
}

export const SyncStateSchema: z.ZodType<SyncState> = z.object({
	responses: z.array(
		z.object({
			questionId: z.string(),
			sectionSlug: z.string(),
			correct: z.boolean(),
			at: z.number()
		})
	),
	timedBest: z
		.object({ score: z.number().int(), bestStreak: z.number().int(), at: z.number() })
		.nullable()
});
