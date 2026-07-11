import type { AnswerRecord, QuizItem } from './engine';
import { readRaw, writeRaw } from './local';
import { mergeServerState } from './storage';
import {
	ATTEMPT_MAX_RESPONSES,
	AttemptPayloadSchema,
	SyncStateSchema,
	TIMED_MAX_RESPONSES,
	type AttemptPayload
} from './payload';

/**
 * Local-first background sync. Quiz pages call the SYNC functions here
 * (enqueueAttempt/buildAttemptPayload); network work happens later in the
 * background and silently degrades to local-only on any failure.
 */

const OUTBOX_KEY = 'bp:sync:v1:outbox';
const OUTBOX_MAX = 50;

function readOutbox(): AttemptPayload[] {
	const raw = readRaw(OUTBOX_KEY);
	if (!raw) return [];
	let entries: unknown[];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		entries = parsed;
	} catch {
		return []; // corrupted — start fresh
	}
	const valid: AttemptPayload[] = [];
	for (const entry of entries) {
		const result = AttemptPayloadSchema.safeParse(entry);
		if (result.success) valid.push(result.data);
		// invalid entry: drop only itself, the rest of the outbox survives
	}
	return valid;
}

function writeOutbox(outbox: AttemptPayload[]): void {
	writeRaw(OUTBOX_KEY, JSON.stringify(outbox.slice(-OUTBOX_MAX)));
}

export function buildAttemptPayload(opts: {
	rulesetId: string;
	mode: 'quick' | 'mastery';
	sectionSlug?: string;
	startedAt: number;
	durationS: number;
	items: QuizItem[];
	records: AnswerRecord[];
	completedAt?: number;
}): AttemptPayload | null {
	const at = opts.completedAt ?? Date.now();
	const byId = new Map(opts.items.map((item) => [item.question.id, item]));
	const responses = [];
	for (const record of opts.records) {
		const item = byId.get(record.questionId);
		if (!item) continue;
		responses.push({
			questionId: record.questionId,
			choiceIndex: item.order[record.chosenChoice],
			at
		});
	}
	if (responses.length === 0) return null;
	return {
		clientId: crypto.randomUUID(),
		rulesetId: opts.rulesetId,
		mode: opts.mode,
		sectionSlug: opts.sectionSlug ?? null,
		startedAt: opts.startedAt,
		durationS: opts.durationS,
		responses: responses.slice(0, ATTEMPT_MAX_RESPONSES)
	};
}

export function enqueueAttempt(payload: AttemptPayload): void {
	writeOutbox([...readOutbox(), payload]);
	// Deferred one microtask: flushOutbox's first `fetch` call must not fire
	// synchronously inside this call, or callers (and tests) have no chance
	// to react/configure mocks between enqueueing and the network attempt.
	queueMicrotask(() => void flushOutbox());
}

let flushing = false;

/** Test-only: clears the in-flight latch. */
export function __resetSync(): void {
	flushing = false;
}

export async function flushOutbox(): Promise<void> {
	if (flushing) return;
	flushing = true;
	try {
		for (;;) {
			const outbox = readOutbox();
			const payload = outbox[0];
			if (!payload) return;
			let res: Response;
			try {
				res = await fetch('/api/attempts', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(payload)
				});
			} catch {
				return; // offline — retry on the next trigger
			}
			if (res.status === 401) return; // signed out — keep queued for after sign-in
			const stored = res.ok || res.status === 409; // 409 = duplicate (already stored)
			const poison = res.status === 400; // permanently invalid — drop so it can't wedge the queue
			if (!stored && !poison) return; // 5xx etc — retry later
			writeOutbox(readOutbox().filter((p) => p.clientId !== payload.clientId));
		}
	} finally {
		flushing = false;
	}
}

export async function hydrateFromServer(rulesetId: string): Promise<void> {
	let res: Response;
	try {
		res = await fetch(`/api/sync?ruleset=${encodeURIComponent(rulesetId)}`);
	} catch {
		return;
	}
	if (!res.ok) return;
	const parsed = SyncStateSchema.safeParse(await res.json().catch(() => null));
	if (!parsed.success) return;
	mergeServerState(rulesetId, parsed.data.responses, parsed.data.timedBest);
}

/** Requests a signed run token; null when signed out/offline (run stays local-only). */
export async function beginTimedRun(): Promise<string | null> {
	try {
		const res = await fetch('/api/timed/start', { method: 'POST' });
		if (!res.ok) return null;
		const data = (await res.json().catch(() => null)) as { token?: string } | null;
		return data?.token ?? null;
	} catch {
		return null;
	}
}

/** Submits a finished timed run for server-side validation. Fire-and-forget. */
export async function submitTimedRun(opts: {
	token: string;
	rulesetId: string;
	items: QuizItem[];
	records: AnswerRecord[];
}): Promise<void> {
	const byId = new Map(opts.items.map((item) => [item.question.id, item]));
	const responses = [];
	for (const record of opts.records) {
		const item = byId.get(record.questionId);
		if (!item) continue;
		responses.push({ questionId: record.questionId, choiceIndex: item.order[record.chosenChoice] });
	}
	if (responses.length === 0) return;
	const capped = responses.slice(0, TIMED_MAX_RESPONSES);
	try {
		await fetch('/api/timed/finish', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ token: opts.token, rulesetId: opts.rulesetId, responses: capped })
		});
	} catch {
		// offline — the run stays local-only by design
	}
}
