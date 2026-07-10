import type { AnswerRecord } from './engine';

export interface ResponseRecord {
	questionId: string;
	sectionSlug: string;
	correct: boolean;
	at: number;
}

export interface TimedResult {
	score: number;
	bestStreak: number;
}

export interface TimedBest extends TimedResult {
	at: number;
}

interface Stored {
	v: 1;
	responses: ResponseRecord[];
	timedBest: TimedBest | null;
}

const MAX_RESPONSES = 2000;
const memory = new Map<string, string>();

/** Test-only: clears the in-memory fallback between tests. */
export function __resetMemory(): void {
	memory.clear();
}

const storageKey = (rulesetId: string) => `bp:quiz:v1:${rulesetId}`;

// Even *referencing* localStorage can throw (sandboxed iframes, privacy-hardened
// configs) and it's undefined in node, so the entire access — reference and method
// call — lives inside the try/catch. No typeof guard: a ReferenceError is caught too.
function readRaw(key: string): string | null {
	try {
		const value = localStorage.getItem(key);
		if (value !== null) return value;
	} catch {
		// localStorage unavailable or blocked — fall through to memory
	}
	return memory.get(key) ?? null;
}

function writeRaw(key: string, value: string): void {
	memory.set(key, value);
	try {
		localStorage.setItem(key, value);
	} catch {
		// unavailable/quota/blocked — memory fallback already holds the value
	}
}

function load(rulesetId: string): Stored {
	const raw = readRaw(storageKey(rulesetId));
	if (raw) {
		try {
			const parsed = JSON.parse(raw) as Stored;
			if (parsed?.v === 1 && Array.isArray(parsed.responses)) return parsed;
		} catch {
			// corrupted — start fresh
		}
	}
	return { v: 1, responses: [], timedBest: null };
}

function save(rulesetId: string, state: Stored): void {
	writeRaw(storageKey(rulesetId), JSON.stringify(state));
}

export function loadResponses(rulesetId: string): ResponseRecord[] {
	return load(rulesetId).responses;
}

export function recordAnswers(rulesetId: string, records: AnswerRecord[], now = Date.now()): void {
	const state = load(rulesetId);
	for (const r of records) {
		state.responses.push({
			questionId: r.questionId,
			sectionSlug: r.sectionSlug,
			correct: r.correct,
			at: now
		});
	}
	state.responses = state.responses.slice(-MAX_RESPONSES);
	save(rulesetId, state);
}

export function getTimedBest(rulesetId: string): TimedBest | null {
	return load(rulesetId).timedBest;
}

export function recordTimedResult(
	rulesetId: string,
	result: TimedResult,
	now = Date.now()
): { isNewBest: boolean; best: TimedBest } {
	const state = load(rulesetId);
	const prev = state.timedBest;
	const isNewBest =
		!prev ||
		result.score > prev.score ||
		(result.score === prev.score && result.bestStreak > prev.bestStreak);
	if (isNewBest) {
		state.timedBest = { ...result, at: now };
		save(rulesetId, state);
	}
	return { isNewBest, best: state.timedBest ?? { ...result, at: now } };
}
