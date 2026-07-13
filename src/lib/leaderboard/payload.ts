import { z } from 'zod';

/** Wire shapes shared by /leaderboard, the timed nudge, and /api/leaderboard. */

export const LEADERBOARD_SIZE = 10;

export interface LeaderboardEntry {
	rank: number;
	displayName: string;
	score: number;
	bestStreak: number;
	at: number; // attempt createdAt, epoch ms
}

const EntrySchema = z.object({
	rank: z.number().int().positive(),
	displayName: z.string(),
	score: z.number().int(),
	bestStreak: z.number().int(),
	at: z.number()
});

export interface LeaderboardResponse {
	entries: LeaderboardEntry[];
	me: LeaderboardEntry | null;
}

export const LeaderboardResponseSchema: z.ZodType<LeaderboardResponse> = z.object({
	entries: z.array(EntrySchema),
	me: EntrySchema.nullable()
});
