import { z } from 'zod';

/** Wire shapes shared by the quiz pages, the sync outbox, and the /api handlers. */

export const ResponsePayloadSchema = z.object({
	questionId: z.string().min(1).max(64),
	// index into question.choices (original order, NOT display order)
	choiceIndex: z.number().int().min(0).max(3),
	// epoch ms
	at: z.number().int().positive()
});
export type ResponsePayload = z.infer<typeof ResponsePayloadSchema>;

export const ATTEMPT_MAX_RESPONSES = 100;

export const AttemptPayloadSchema = z.object({
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
export type AttemptPayload = z.infer<typeof AttemptPayloadSchema>;

export const TIMED_DURATION_S = 300;
export const TIMED_GRACE_S = 20; // server-side slack for network + clock skew
export const TIMED_MAX_RESPONSES = 300; // ~1 answer/second ceiling, scaled to the duration

export const TimedFinishPayloadSchema = z.object({
	token: z.string().min(1).max(2048),
	rulesetId: z.string().min(1).max(64),
	// answer order matters (streak)
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
export type TimedFinishPayload = z.infer<typeof TimedFinishPayloadSchema>;

export const SyncStateSchema = z.object({
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
export type SyncState = z.infer<typeof SyncStateSchema>;
