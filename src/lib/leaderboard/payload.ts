import { z } from 'zod';

/** Wire shapes shared by /leaderboard, the timed nudge, and /api/leaderboard. */

export const LEADERBOARD_SIZE = 10;

export const LeaderboardEntrySchema = z.object({
	rank: z.number().int().positive(),
	displayName: z.string(),
	score: z.number().int(),
	bestStreak: z.number().int(),
	/** attempt createdAt, epoch ms */
	at: z.number()
});
export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;

export const LeaderboardResponseSchema = z.object({
	entries: z.array(LeaderboardEntrySchema),
	me: LeaderboardEntrySchema.nullable()
});
export type LeaderboardResponse = z.infer<typeof LeaderboardResponseSchema>;
