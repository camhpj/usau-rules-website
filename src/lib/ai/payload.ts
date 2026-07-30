import { z } from 'zod';
import { QuestionSchema } from '$lib/quiz/types';

/** Wire shapes shared by the AI pages and the /api/ai handlers. */

export const ScenarioRequestSchema = z.object({
	rulesetId: z.string().min(1).max(64).optional(),
	difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional()
});
export type ScenarioRequest = z.infer<typeof ScenarioRequestSchema>;

export const ScenarioResponseSchema = z.object({
	source: z.enum(['ai', 'fallback']),
	remaining: z.number().int().min(0),
	question: QuestionSchema
});
export type ScenarioResponse = z.infer<typeof ScenarioResponseSchema>;

/** GET /api/ai/scenario — remaining daily quota for the signed-in user. */
export const ScenarioQuotaSchema = z.object({ remaining: z.number().int().min(0) });

/** ---- Ask chat (multi-turn) wire shapes ---- */

export const CHAT_MAX_MESSAGE_CHARS = 500;
/** Hard per-conversation size guardrail (messages of both roles combined). */
export const CONVERSATION_MESSAGE_CAP = 25;

export const ChatPayloadSchema = z.object({
	message: z.string().trim().min(3).max(CHAT_MAX_MESSAGE_CHARS),
	// NOT z.string().uuid(): migrated conversations have derived ids like 'conv-<uuid>'.
	conversationId: z.string().min(1).max(64).optional(),
	rulesetId: z.string().min(1).max(64).optional()
});
export type ChatPayload = z.infer<typeof ChatPayloadSchema>;

export const ChatRetryPayloadSchema = z.object({
	// NOT z.string().uuid(): migrated conversations have derived ids like 'conv-<uuid>'.
	conversationId: z.string().min(1).max(64),
	retry: z.literal(true)
});
/** Regenerate the answer to a conversation's trailing failed exchange. */
export type ChatRetryPayload = z.infer<typeof ChatRetryPayloadSchema>;

/** Sidebar title derived from the first message. */
export function deriveTitle(message: string): string {
	return message.trim().replace(/\s+/g, ' ').slice(0, 80);
}

export const ConversationSummarySchema = z.object({
	id: z.string(),
	title: z.string(),
	// ms epoch of last message
	updatedAt: z.number(),
	/** Client-only: optimistic sidebar entry awaiting its server id. */
	pending: z.boolean().optional()
});
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;

export const ConversationListResponseSchema = z.object({
	conversations: z.array(ConversationSummarySchema),
	hasMore: z.boolean()
});
export type ConversationListResponse = z.infer<typeof ConversationListResponseSchema>;

export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	status: 'complete' | 'truncated' | 'error' | null; // assistant only; null for user rows
	feedback: 'up' | 'down' | null; // assistant only
	createdAt: number;
}

export interface ConversationDetail {
	id: string;
	title: string;
	rulesetId: string;
	messages: ChatMessage[];
}
