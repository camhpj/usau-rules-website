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

export interface RetryTarget {
	/** The failed assistant row a retry deletes before regenerating. */
	errorRowId: string;
	/** The user question being regenerated. */
	question: string;
	/** Rows preceding the question, for priorTurns assembly. */
	prior: StoredTurn[];
}

/**
 * Locate what a retry regenerates: the conversation's last row must be a
 * failed assistant row with a user question somewhere before it. Returns
 * null when the transcript doesn't end in a retryable failure.
 */
export function pickRetryTarget(rows: (StoredTurn & { id: string })[]): RetryTarget | null {
	const last = rows[rows.length - 1];
	if (!last || last.role !== 'assistant' || last.status !== 'error') return null;
	for (let i = rows.length - 2; i >= 0; i--) {
		if (rows[i].role === 'user') {
			return { errorRowId: last.id, question: rows[i].content, prior: rows.slice(0, i) };
		}
	}
	return null;
}
