/** Transcript assembly for multi-turn ask chat. */

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
