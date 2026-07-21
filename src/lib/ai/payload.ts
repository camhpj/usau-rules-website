import { z } from 'zod';
import { QuestionSchema, type Question } from '$lib/quiz/types';

/** Wire shapes shared by the AI pages and the /api/ai handlers. */

export interface ScenarioRequest {
	rulesetId?: string;
	difficulty?: 1 | 2 | 3;
}

export const ScenarioRequestSchema: z.ZodType<ScenarioRequest> = z.object({
	rulesetId: z.string().min(1).max(64).optional(),
	difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional()
});

export interface ScenarioResponse {
	source: 'ai' | 'fallback';
	remaining: number;
	question: Question;
}

export const ScenarioResponseSchema: z.ZodType<ScenarioResponse> = z.object({
	source: z.enum(['ai', 'fallback']),
	remaining: z.number().int().min(0),
	question: QuestionSchema
});

/** GET /api/ai/scenario — remaining daily quota for the signed-in user. */
export const ScenarioQuotaSchema = z.object({ remaining: z.number().int().min(0) });

/** ---- Ask chat (multi-turn) wire shapes ---- */

export const CHAT_MAX_MESSAGE_CHARS = 500;
/** Hard per-conversation size guardrail (messages of both roles combined). */
export const CONVERSATION_MESSAGE_CAP = 25;

export interface ChatPayload {
	message: string;
	conversationId?: string;
	rulesetId?: string;
}

export const ChatPayloadSchema: z.ZodType<ChatPayload> = z.object({
	message: z.string().trim().min(3).max(CHAT_MAX_MESSAGE_CHARS),
	// NOT z.string().uuid(): migrated conversations have derived ids like 'conv-<uuid>'.
	conversationId: z.string().min(1).max(64).optional(),
	rulesetId: z.string().min(1).max(64).optional()
});

/** Sidebar title derived from the first message. */
export function deriveTitle(message: string): string {
	return message.trim().replace(/\s+/g, ' ').slice(0, 80);
}

export interface ConversationSummary {
	id: string;
	title: string;
	updatedAt: number; // ms epoch of last message
	/** Client-only: optimistic sidebar entry awaiting its server id. */
	pending?: boolean;
}

export interface ConversationListResponse {
	conversations: ConversationSummary[];
	hasMore: boolean;
}

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
