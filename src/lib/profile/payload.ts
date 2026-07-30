import { z } from 'zod';

/** Wire shapes shared by the dashboard/nudge UI and /api/profile/display-name. */

export const DisplayNameStateSchema = z.object({
	displayName: z.string().nullable(),
	suggestion: z.string()
});
export type DisplayNameState = z.infer<typeof DisplayNameStateSchema>;

export const PutDisplayNameSchema = z.object({
	displayName: z.string().max(200).nullable(),
	resolveConflict: z.boolean().optional()
});
export type PutDisplayName = z.infer<typeof PutDisplayNameSchema>;
