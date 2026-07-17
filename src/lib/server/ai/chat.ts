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
 * DB status for a finished stream. Partial answers are worth keeping — an
 * errored stream that produced text persists as truncated; a stream that
 * produced no answer text at all (thoughts only) is an error row regardless
 * of how it ended.
 */
export function statusForStream(
	outcome: StreamOutcome,
	answerText: string
): 'complete' | 'truncated' | 'error' {
	if (!answerText.trim()) return 'error';
	return outcome === 'error' ? 'truncated' : outcome;
}
