import { z } from 'zod';
import { QuestionSchema, type Question } from '$lib/quiz/types';

/** Wire shapes shared by the AI pages and the /api/ai handlers. */

export const ASK_MAX_PROMPT_CHARS = 500;

export interface AskPayload {
	prompt: string; // top-level "prompt" field — Cloudflare Firewall-for-AI compatible
	rulesetId?: string;
}

export const AskPayloadSchema: z.ZodType<AskPayload> = z.object({
	prompt: z.string().trim().min(3).max(ASK_MAX_PROMPT_CHARS),
	rulesetId: z.string().min(1).max(64).optional()
});

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
