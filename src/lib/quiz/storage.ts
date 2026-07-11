import type { AnswerRecord } from './engine';
import { readRaw, writeRaw } from './local';

export { __resetLocal as __resetMemory } from './local';

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

const storageKey = (rulesetId: string) => `bp:quiz:v1:${rulesetId}`;

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

function isBetter(result: TimedResult, prev: TimedBest | null): boolean {
	return (
		!prev ||
		result.score > prev.score ||
		(result.score === prev.score && result.bestStreak > prev.bestStreak)
	);
}

export function recordTimedResult(
	rulesetId: string,
	result: TimedResult,
	now = Date.now()
): { isNewBest: boolean; best: TimedBest } {
	const state = load(rulesetId);
	const prev = state.timedBest;
	const isNewBest = isBetter(result, prev);
	if (isNewBest) {
		state.timedBest = { ...result, at: now };
		save(rulesetId, state);
	}
	return { isNewBest, best: state.timedBest ?? { ...result, at: now } };
}

/**
 * Background-sync entry point: folds server history into the local cache.
 * Local-first — an existing local history is never overwritten; the server
 * timed best is adopted only when it beats the local one.
 */
export function mergeServerState(
	rulesetId: string,
	responses: ResponseRecord[],
	timedBest: TimedBest | null
): void {
	const state = load(rulesetId);
	let changed = false;
	if (state.responses.length === 0 && responses.length > 0) {
		state.responses = [...responses].sort((a, b) => a.at - b.at).slice(-MAX_RESPONSES);
		changed = true;
	}
	if (timedBest && isBetter(timedBest, state.timedBest)) {
		state.timedBest = timedBest;
		changed = true;
	}
	if (changed) save(rulesetId, state);
}
