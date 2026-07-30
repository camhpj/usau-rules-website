import { z } from 'zod';

/** Wire shapes shared by the bookmarks store and /api/bookmarks. */

export const BookmarkSchema = z.object({
	rulesetId: z.string().min(1).max(64),
	ruleId: z.string().min(1).max(64),
	createdAt: z.number()
});
export type Bookmark = z.infer<typeof BookmarkSchema>;

export const BookmarksResponseSchema = z.object({
	bookmarks: z.array(BookmarkSchema)
});
export type BookmarksResponse = z.infer<typeof BookmarksResponseSchema>;

/** Request body for both PUT (add) and DELETE (remove). */
export const BookmarkTargetSchema = BookmarkSchema.omit({ createdAt: true });
export type BookmarkTarget = z.infer<typeof BookmarkTargetSchema>;
