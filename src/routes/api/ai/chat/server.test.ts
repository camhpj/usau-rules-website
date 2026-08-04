import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONVERSATION_MESSAGE_CAP } from '$lib/ai/payload';
import { DEFAULT_RULESET_ID } from '$lib/content/config';
import { ASK_DAILY_PER_USER } from '$lib/server/ai/config';
import { buildAskPrompt } from '$lib/server/ai/prompts';
import { QUOTA_MESSAGE } from '$lib/server/ai/guardrails';
import type { Db } from '$lib/server/db';
import { aiConversations, aiMessages, aiUsage } from '$lib/server/db/schema';
import type { RequestEvent } from './$types';

// Gemini itself stays mocked per the task-3 brief: the live HTTP contract is a
// recorded, accepted risk elsewhere. Everything else in `$lib/server/ai/gemini`
// (notably `d1CacheStore`, which the handler constructs unconditionally) stays
// real — it never touches the fake db unless `streamText` actually calls it,
// which the mock below never does.
vi.mock('$lib/server/ai/gemini', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/ai/gemini')>();
	return { ...actual, streamText: vi.fn() };
});

import { streamText } from '$lib/server/ai/gemini';
import { POST } from './+server';

const streamTextMock = vi.mocked(streamText);

function fakeStream(): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			controller.close();
		}
	});
}

/**
 * A `Request` whose `.json()` throws if called a second time. The handler
 * deliberately reads the body once and shares the parsed value across two
 * `safeParse` calls (that's why it isn't a `parseJsonBody` caller); using this
 * fake for every test pins that invariant continuously, not just in a
 * dedicated test.
 */
function fakeRequest(body: unknown): Request {
	let calls = 0;
	return {
		headers: new Headers(),
		json: async () => {
			calls++;
			if (calls > 1) throw new Error('test: request body was read more than once');
			return body;
		}
	} as unknown as Request;
}

type ConversationRow = { id: string; rulesetId: string; title: string };
type MessageRow = {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	status: 'complete' | 'truncated' | 'error' | null;
};

/**
 * A fake `Db` covering only what the chat handler touches: the owned-conversation
 * lookup, the prior-messages fetch, the usage-cap lookup/increment, and the
 * insert/delete/update calls persistence makes. Dispatch is by table identity
 * (`===` against the real schema exports), mirroring `record-attempt.test.ts`'s
 * approach to faking `Db`, generalized to the several tables this route reads
 * and writes.
 */
function fakeDb(opts: {
	conversation: ConversationRow | null;
	priorMessages?: MessageRow[];
	usageCount?: number;
	deleteReturns?: { id: string }[];
}) {
	const priorMessages = opts.priorMessages ?? [];
	const usageCount = opts.usageCount ?? 0;
	const deleteReturns = opts.deleteReturns ?? [];
	const inserts: { table: unknown; values: Record<string, unknown> }[] = [];
	const deletes: { table: unknown }[] = [];
	const updates: { table: unknown; values: Record<string, unknown> }[] = [];
	let usageIncrements = 0;

	const db = {
		select() {
			return {
				from(table: unknown) {
					if (table === aiConversations) {
						return {
							where: () => ({ limit: async () => (opts.conversation ? [opts.conversation] : []) })
						};
					}
					if (table === aiMessages) {
						return { where: () => ({ orderBy: async () => priorMessages }) };
					}
					if (table === aiUsage) {
						return { where: () => ({ limit: async () => [{ count: usageCount }] }) };
					}
					throw new Error(`fakeDb: unexpected select from ${String(table)}`);
				}
			};
		},
		insert(table: unknown) {
			return {
				values(values: Record<string, unknown>) {
					inserts.push({ table, values });
					if (table === aiUsage) {
						return { onConflictDoUpdate: async () => void usageIncrements++ };
					}
					return {};
				}
			};
		},
		delete(table: unknown) {
			return {
				where() {
					deletes.push({ table });
					return { returning: async () => deleteReturns };
				}
			};
		},
		update(table: unknown) {
			return {
				set(values: Record<string, unknown>) {
					return {
						where: async () => void updates.push({ table, values })
					};
				}
			};
		}
	};

	return {
		db: db as never as Db,
		inserts,
		deletes,
		updates,
		usageIncrements: () => usageIncrements
	};
}

function fakeEvent(opts: {
	db: Db;
	body: unknown;
	userId?: string;
	env?: Record<string, string | undefined>;
}): RequestEvent {
	return {
		request: fakeRequest(opts.body),
		locals: {
			auth: { api: { getSession: async () => ({ user: { id: opts.userId ?? 'user-1' } }) } },
			db: opts.db
		},
		platform: {
			env: { GEMINI_API_KEY: 'test-key', ...opts.env }
		}
	} as unknown as RequestEvent;
}

/** `n` alternating user/assistant rows, all `complete` — filler to reach CONVERSATION_MESSAGE_CAP. */
function fillerMessages(n: number): MessageRow[] {
	return Array.from({ length: n }, (_, i) =>
		i % 2 === 0
			? { id: `u${i}`, role: 'user', content: `filler question ${i}`, status: null }
			: { id: `a${i}`, role: 'assistant', content: `filler answer ${i}`, status: 'complete' }
	);
}

beforeEach(() => {
	streamTextMock.mockReset();
	streamTextMock.mockImplementation(async () => fakeStream());
});

describe('POST /api/ai/chat', () => {
	// Case 1: the message cap applies to a normal (non-retry) send.
	it('returns 400 with the exact cap message when the conversation is already full', async () => {
		const { db, inserts } = fakeDb({
			conversation: { id: 'conv-1', rulesetId: DEFAULT_RULESET_ID, title: 'A conversation' },
			priorMessages: fillerMessages(CONVERSATION_MESSAGE_CAP)
		});
		const event = fakeEvent({
			db,
			body: { message: 'Is this conversation full yet?', conversationId: 'conv-1' }
		});

		await expect(POST(event)).rejects.toMatchObject({
			status: 400,
			body: { message: 'This conversation is full — start a new one' }
		});
		expect(inserts).toEqual([]); // rejected before any persistence
		expect(streamTextMock).not.toHaveBeenCalled();
	});

	// Case 2: the cap does NOT apply to a retry — it skips the cap check entirely
	// and goes to `pickRetryTarget`. Also exercises case 5 (single body read) via
	// `fakeRequest`, for the retry-body parse path.
	it('lets a retry through even when prior.length is at the cap', async () => {
		const prior = [
			...fillerMessages(CONVERSATION_MESSAGE_CAP - 2),
			{ id: 'u-last', role: 'user' as const, content: 'What is a travel?', status: null },
			{ id: 'a-fail', role: 'assistant' as const, content: '', status: 'error' as const }
		];
		expect(prior.length).toBe(CONVERSATION_MESSAGE_CAP); // at the cap, not under it
		const { db, deletes, inserts } = fakeDb({
			conversation: { id: 'conv-1', rulesetId: DEFAULT_RULESET_ID, title: 'A conversation' },
			priorMessages: prior,
			usageCount: 0,
			deleteReturns: [{ id: 'a-fail' }]
		});
		const event = fakeEvent({ db, body: { conversationId: 'conv-1', retry: true } });

		const response = await POST(event);

		expect(response.status).toBe(200);
		expect(response.headers.get('x-bp-conversation-id')).toBe('conv-1');
		expect(deletes).toEqual([{ table: aiMessages }]); // the retry-delete happened
		// A retry never inserts a fresh user or assistant message — the only insert
		// this request makes is the quota-usage increment.
		expect(inserts.find((i) => i.table === aiMessages)).toBeUndefined();
		expect(inserts.find((i) => i.table === aiConversations)).toBeUndefined();
		expect(streamTextMock).toHaveBeenCalledTimes(1);
		const request = streamTextMock.mock.calls[0][0];
		expect(request.taskPrompt).toBe(buildAskPrompt('What is a travel?')); // regenerated the right question
	});

	// Case 3a: quota exhaustion.
	it('returns 429 with the quota message when the daily cap is already used up', async () => {
		const { db, inserts, usageIncrements } = fakeDb({
			conversation: null, // unused: this is a new conversation
			usageCount: ASK_DAILY_PER_USER
		});
		const event = fakeEvent({ db, body: { message: 'What happens on a foul call?' } });

		await expect(POST(event)).rejects.toMatchObject({
			status: 429,
			body: { message: QUOTA_MESSAGE.ask }
		});
		expect(usageIncrements()).toBe(0); // denied requests are never recorded
		expect(inserts).toEqual([]); // rejected before persistence
		expect(streamTextMock).not.toHaveBeenCalled();
	});

	// Case 3b: a successful request increments the counter exactly once. Also
	// exercises case 5 (single body read) for the new-message parse path.
	it('increments the usage counter exactly once on a successful new-message request', async () => {
		const { db, inserts, usageIncrements } = fakeDb({ conversation: null, usageCount: 0 });
		const event = fakeEvent({ db, body: { message: 'What happens on a foul call?' } });

		const response = await POST(event);

		expect(response.status).toBe(200);
		expect(response.headers.get('x-bp-ai-remaining')).toBe(String(ASK_DAILY_PER_USER - 1));
		expect(usageIncrements()).toBe(1);
		const convoInsert = inserts.find((i) => i.table === aiConversations);
		const messageInsert = inserts.find((i) => i.table === aiMessages);
		expect(convoInsert).toBeDefined();
		expect(messageInsert?.values.content).toBe('What happens on a foul call?');
		// The conversation id in the response header is the one actually persisted.
		expect(response.headers.get('x-bp-conversation-id')).toBe(convoInsert!.values.id);
	});

	// Case 4: the route's *handling* of a failed ownership lookup, not the lookup
	// itself. This fake ignores the `where` predicate and always returns `null`,
	// so it pins "a null result from getOwnedConversation produces a 404 with
	// this exact message" — the one branch the route has on that result, shared
	// by a missing id and a foreign-owned one alike. It does NOT exercise the
	// userId condition that actually enforces ownership; that predicate is
	// pinned directly in `src/lib/server/ai/conversations.test.ts`, where it's
	// shared by every caller of `ownedConversationWhere`, not just this route.
	it('returns 404 when the conversation lookup comes back null', async () => {
		const { db } = fakeDb({ conversation: null });
		const event = fakeEvent({
			db,
			body: { message: 'Can I see this conversation?', conversationId: 'someone-elses-convo' }
		});

		await expect(POST(event)).rejects.toMatchObject({
			status: 404,
			body: { message: 'conversation not found' }
		});
		expect(streamTextMock).not.toHaveBeenCalled();
	});
});
