import { z } from 'zod';

/** Wire shapes shared by the dashboard/nudge UI and /api/profile/display-name. */

export interface DisplayNameState {
	displayName: string | null;
	suggestion: string;
}

export const DisplayNameStateSchema: z.ZodType<DisplayNameState> = z.object({
	displayName: z.string().nullable(),
	suggestion: z.string()
});

export interface PutDisplayName {
	displayName: string | null;
	resolveConflict?: boolean;
}

export const PutDisplayNameSchema: z.ZodType<PutDisplayName> = z.object({
	displayName: z.string().max(200).nullable(),
	resolveConflict: z.boolean().optional()
});
