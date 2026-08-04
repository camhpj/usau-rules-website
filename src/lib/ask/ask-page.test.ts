import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ConversationDetail } from '$lib/ai/payload';
import { AskPageState } from './ask-page.svelte';
import { chatStream, StreamJob } from './chat-stream.svelte';
import { conversations } from './conversations.svelte';

/** A promise plus its resolver, so a test can control exactly when a fetch settles. */
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

/** A ReadableStream a test can push into (or leave open) on its own schedule,
 * for simulating a chat response whose body hasn't finished streaming yet. */
function controlledStream() {
	let controller!: ReadableStreamDefaultController<Uint8Array>;
	const stream = new ReadableStream<Uint8Array>({
		start(c) {
			controller = c;
		}
	});
	return { stream, close: () => controller.close() };
}

/** Flushes both microtasks and the odd macrotask-scheduled continuation
 * (e.g. Response#json), unlike a fixed number of `await Promise.resolve()`s. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const jsonResponse = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const msg = (
	id: string,
	role: ChatMessage['role'],
	overrides: Partial<ChatMessage> = {}
): ChatMessage => ({
	id,
	role,
	content: 'x',
	status: null,
	feedback: null,
	createdAt: 1,
	...overrides
});

const detail = (id: string, messages: ChatMessage[] = []): ConversationDetail => ({
	id,
	title: 'T',
	rulesetId: 'r',
	messages
});

function callbacks() {
	return { scrollToEnd: vi.fn(), adoptUrl: vi.fn() };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
	// AskPageState calls the real chatStream/conversations singletons (like every
	// other class in this directory) rather than mocking them — reset both so a
	// prior test's jobs, completed exchanges, or sidebar entries can't leak in.
	conversations.reset();
	chatStream.jobs.clear();
	chatStream.completed.clear();
	chatStream.remaining = null;
});
afterEach(() => vi.unstubAllGlobals());

describe('AskPageState navigation vs. conversation load', () => {
	// This is the guard named in the task brief: a response arriving after the
	// user navigated to a different conversation must not apply. It was not
	// reachable as a unit test before this extraction — `loadConversation` and
	// `viewGeneration` were closures private to the .svelte file.
	it("a stale conversation load must not apply, and must not clear the newer load's skeleton", async () => {
		const state = new AskPageState(null, callbacks());

		const first = deferred<Response>();
		fetchMock.mockReturnValueOnce(first.promise);
		state.handleNavigate('conv-a');
		expect(state.loadingConvo).toBe(true);

		const second = deferred<Response>();
		fetchMock.mockReturnValueOnce(second.promise);
		state.handleNavigate('conv-b'); // supersedes conv-a's in-flight load
		expect(state.activeId).toBe('conv-b');
		expect(state.messages).toEqual([]);

		// conv-a's load finally resolves, after the navigation away from it.
		first.resolve(jsonResponse(detail('conv-a', [msg('m1', 'user')])));
		await tick();

		expect(state.messages).toEqual([]); // conv-a's transcript never applied
		expect(state.activeId).toBe('conv-b');
		expect(state.loadingConvo).toBe(true); // the stale settle did not clear conv-b's skeleton

		// conv-b's own load settles normally and is unaffected by the stale one.
		const freshMessages = [msg('m2', 'assistant', { status: 'complete' })];
		second.resolve(jsonResponse(detail('conv-b', freshMessages)));
		await tick();

		expect(state.messages).toEqual(freshMessages);
		expect(state.loadingConvo).toBe(false);
	});

	it('a 404 for a since-abandoned conversation must not flag the new view as not-found', async () => {
		const state = new AskPageState(null, callbacks());

		const first = deferred<Response>();
		fetchMock.mockReturnValueOnce(first.promise);
		state.handleNavigate('conv-missing');

		fetchMock.mockReturnValueOnce(new Promise(() => {})); // conv-b's own load; left pending
		state.handleNavigate('conv-b');

		first.resolve(new Response(null, { status: 404 }));
		await tick();

		expect(state.notFound).toBe(false); // the 404 belonged to the abandoned view, not this one
		expect(state.activeId).toBe('conv-b');
	});
});

describe('AskPageState.send', () => {
	// The second guard named in the brief: a second send while one is in
	// flight. chatStream itself also refuses a second concurrent send for the
	// same view (via jobFor), but that refusal was never reachable from a test
	// because `send()`'s own pre-check and its optimistic-bubble bookkeeping
	// lived in the .svelte file.
	it('a second send while one is in flight is a no-op: no duplicate request, bubble, or input clear', async () => {
		const state = new AskPageState(null, callbacks());

		const gate = deferred<Response>();
		fetchMock.mockReturnValueOnce(gate.promise);
		state.input = 'What is a travel call?';
		const first = state.send();

		// Synchronous up to the network call: the guard state is already live.
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(state.messages).toHaveLength(1);
		expect(state.activeJob).not.toBeNull();

		state.input = 'A second message';
		await state.send(); // must return immediately: this.activeJob is truthy

		expect(fetchMock).toHaveBeenCalledTimes(1); // no second POST
		expect(state.messages).toHaveLength(1); // no second optimistic bubble
		expect(state.input).toBe('A second message'); // send() bailed before touching it

		gate.resolve(new Response(null, { status: 500 }));
		await first;
	});

	// Bug-relevant "recoverable state" guard: a send that fails before headers
	// (network drop) must roll back the optimistic bubble and hand the typed
	// text back to the composer rather than losing it.
	it('a failed send rolls back the optimistic bubble and restores the input for retry', async () => {
		const state = new AskPageState(null, callbacks());
		fetchMock.mockRejectedValueOnce(new Error('network down'));

		state.input = 'What is a travel call?';
		await state.send();

		expect(state.messages).toEqual([]);
		expect(state.input).toBe('What is a travel call?');
		expect(state.errorMessage).toBe('Network error — try again.');
		expect(state.activeJob).toBeNull();
	});

	// A different flavor of the brief's first guard, applied to send() instead
	// of loadConversation(): a send's result must not land on a view the user
	// has since navigated away from — not the rollback, not the error message.
	it("a send's result arriving after navigating away must not touch the new view", async () => {
		const state = new AskPageState(null, callbacks());

		const sendGate = deferred<Response>();
		fetchMock.mockReturnValueOnce(sendGate.promise); // the send's POST
		fetchMock.mockReturnValueOnce(new Promise(() => {})); // handleNavigate's own GET; left pending

		state.input = 'Hello';
		const pending = state.send();
		state.handleNavigate('other-convo'); // supersedes the send before it settles

		expect(state.activeId).toBe('other-convo');
		expect(state.messages).toEqual([]);

		sendGate.resolve(new Response(null, { status: 500 }));
		await pending;

		expect(state.messages).toEqual([]); // no bubble resurrected
		expect(state.errorMessage).toBeNull(); // no error message applied to this view
		expect(state.input).toBe(''); // not restored — the text belonged to the abandoned view
		expect(state.activeId).toBe('other-convo');
	});
});

describe('AskPageState.consumeCompletedIfReady', () => {
	it('applies a background-finished exchange once and dedupes against an already-loaded row', async () => {
		const cb = callbacks();
		const state = new AskPageState(null, cb);
		fetchMock.mockResolvedValueOnce(jsonResponse(detail('conv-1')));
		state.handleNavigate('conv-1');
		await tick();
		expect(state.loadingConvo).toBe(false);
		cb.scrollToEnd.mockClear();

		const row = msg('srv-1', 'assistant', { status: 'complete' });
		state.messages = [row]; // already present, e.g. the load's own transcript included it
		chatStream.completed.set('conv-1', row);

		state.consumeCompletedIfReady();

		expect(state.messages).toEqual([row]); // not appended a second time
		expect(chatStream.completed.has('conv-1')).toBe(false); // still consumed
		expect(cb.scrollToEnd).not.toHaveBeenCalled(); // nothing new appeared, so no scroll
	});

	it('defers while the transcript load is still in flight, so it never races #loadConversation', async () => {
		const state = new AskPageState(null, callbacks());
		const gate = deferred<Response>();
		fetchMock.mockReturnValueOnce(gate.promise);
		state.handleNavigate('conv-2');
		expect(state.loadingConvo).toBe(true);

		chatStream.completed.set('conv-2', msg('srv-2', 'assistant', { status: 'complete' }));
		state.consumeCompletedIfReady();

		expect(state.messages).toEqual([]); // deferred: loadingConvo is still true
		expect(chatStream.completed.has('conv-2')).toBe(true); // left for a later check

		gate.resolve(jsonResponse(detail('conv-2')));
		await tick();
	});
});

describe('AskPageState.checkUrlAdoption', () => {
	it("adopts the id once headers arrive for this view's own send, before the body finishes streaming", async () => {
		const cb = callbacks();
		const state = new AskPageState(null, cb);

		const gate = deferred<Response>();
		fetchMock.mockReturnValueOnce(gate.promise);
		state.input = 'What is a travel call?';
		const pending = state.send();

		const { stream, close } = controlledStream();
		gate.resolve(
			new Response(stream, {
				status: 200,
				headers: { 'x-bp-conversation-id': 'conv-new', 'x-bp-message-id': 'm-1' }
			})
		);
		await Promise.resolve();
		await Promise.resolve();

		// Headers have landed (chatStream sets job.conversationId synchronously once
		// they do) but the body — and this send() call — are still in flight.
		state.checkUrlAdoption();

		expect(state.activeId).toBe('conv-new');
		expect(cb.adoptUrl).toHaveBeenCalledTimes(1);
		expect(cb.adoptUrl).toHaveBeenCalledWith('conv-new');

		state.checkUrlAdoption(); // a reactive re-run must not adopt twice
		expect(cb.adoptUrl).toHaveBeenCalledTimes(1);

		close();
		await pending;
	});

	it('ignores a job that belongs to a different view, even one resolved to a real conversation', () => {
		const cb = callbacks();
		const state = new AskPageState(null, cb);
		// Another /ask view's send resolved to a real id under its own token —
		// this view (a fresh blank composer) must not adopt someone else's chat.
		chatStream.jobs.set(
			'someone-elses-key',
			new StreamJob('someone-elses-key', 'conv-not-mine', Symbol('other view'))
		);

		state.checkUrlAdoption();

		expect(state.activeId).toBeNull();
		expect(cb.adoptUrl).not.toHaveBeenCalled();
	});
});
