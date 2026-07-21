/** Transcript assembly for multi-turn ask chat. */

import type { StreamOutcome } from './gemini';

export interface StoredTurn {
	role: 'user' | 'assistant';
	content: string;
	status: string | null;
}

/** DB rows → Gemini turns. Error/empty assistant rows carry no signal — drop them. */
export function toGeminiTurns(messages: StoredTurn[]): { role: 'user' | 'model'; text: string }[] {
	return messages
		.filter((m) => m.content !== '' && (m.role === 'user' || m.status !== 'error'))
		.map((m) => ({
			role: m.role === 'user' ? ('user' as const) : ('model' as const),
			text: m.content
		}));
}

/**
 * DB status for a finished stream, or null when no assistant row should be
 * persisted. Partial answers are worth keeping — an errored or cancelled
 * stream that produced text persists as truncated. A stream that ends with
 * no answer text persists as an error row — except a cancelled one: the
 * client walked away before any answer existed, so the transcript keeps
 * only the user's question.
 */
export function statusForStream(
	outcome: StreamOutcome,
	answerText: string
): 'complete' | 'truncated' | 'error' | null {
	if (!answerText.trim()) return outcome === 'cancelled' ? null : 'error';
	if (outcome === 'error' || outcome === 'cancelled') return 'truncated';
	return outcome;
}
