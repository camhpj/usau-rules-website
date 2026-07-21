import { SvelteMap } from 'svelte/reactivity';
import { deriveTitle, type ChatMessage } from '$lib/ai/payload';
import { conversations } from './conversations.svelte';

/** No bytes for this long while streaming → show the stall hint. */
const STALL_HINT_MS = 20_000;

/** App-wide ceiling on simultaneous streams (each also holds a daily-quota unit). */
export const MAX_CONCURRENT_STREAMS = 3;

/** One in-flight exchange. Alive only while streaming; removed on settle. */
export class StreamJob {
	/** Set once response headers arrive; null while a new conversation's id is pending. */
	conversationId = $state<string | null>(null);
	/** Identifies the view instance that initiated the send (URL-adoption ownership). */
	viewToken = $state<symbol | null>(null);
	streamingText = $state('');
	thoughts = $state('');
	stalled = $state(false);
	readonly controller = new AbortController();
	stallTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		readonly key: string,
		conversationId: string | null,
		viewToken: symbol
	) {
		this.conversationId = conversationId;
		this.viewToken = viewToken;
	}
}

export type SendResult =
	| { kind: 'done'; message: string | null }
	| { kind: 'failed'; message: string }
	| { kind: 'rejected'; message: string };

/**
 * Module-scope chat streaming state. Lives outside the page component so
 * in-flight sends keep streaming across route changes — leaving the page never
 * interrupts a request. Only stop() aborts, and the server treats a client
 * abort as a real cancel: Gemini stops and only generated text is persisted.
 * Multiple conversations may stream at once (one stream per conversation,
 * MAX_CONCURRENT_STREAMS overall).
 */
class ChatStreamState {
	/** Live streams by job key (conversation id, or a temp key until headers arrive). */
	jobs = new SvelteMap<string, StreamJob>();
	/** Finished assistant messages by conversation id, awaiting pickup by that view. */
	completed = new SvelteMap<string, ChatMessage>();
	remaining = $state<number | null>(null);

	jobFor(conversationId: string | null): StreamJob | null {
		if (!conversationId) return null;
		for (const job of this.jobs.values()) {
			if (job.conversationId === conversationId) return job;
		}
		return null;
	}

	/** The job belonging to what a view shows: its conversation, or a send it initiated. */
	jobForView(activeId: string | null, viewToken: symbol): StreamJob | null {
		for (const job of this.jobs.values()) {
			if (job.conversationId !== null && job.conversationId === activeId) return job;
			if (job.viewToken === viewToken) return job;
		}
		return null;
	}

	get atCap(): boolean {
		return this.jobs.size >= MAX_CONCURRENT_STREAMS;
	}

	stop(job: StreamJob): void {
		job.controller.abort();
	}

	consumeCompleted(conversationId: string): void {
		this.completed.delete(conversationId);
	}

	#armStall(job: StreamJob): void {
		if (job.stallTimer) clearTimeout(job.stallTimer);
		job.stalled = false;
		job.stallTimer = setTimeout(() => (job.stalled = true), STALL_HINT_MS);
	}

	#settle(job: StreamJob): void {
		if (job.stallTimer) clearTimeout(job.stallTimer);
		job.stallTimer = null;
		this.jobs.delete(job.key);
	}

	/** Park the finished assistant bubble for pickup and bump the sidebar. */
	#finish(
		job: StreamJob,
		status: 'complete' | 'truncated' | 'error',
		messageId: string | null
	): void {
		if (job.conversationId) {
			this.completed.set(job.conversationId, {
				id: messageId ?? `local-${crypto.randomUUID()}`,
				role: 'assistant',
				content: status === 'error' ? '' : job.streamingText,
				status,
				feedback: null,
				createdAt: Date.now()
			});
			conversations.touch(job.conversationId, Date.now());
		}
		this.#settle(job);
	}

	async send(
		text: string,
		opts: { conversationId: string | null; viewToken: symbol; retry?: boolean }
	): Promise<SendResult> {
		if (this.jobFor(opts.conversationId)) {
			return {
				kind: 'rejected',
				message: 'This conversation is already answering — wait for it to finish.'
			};
		}
		if (this.atCap) {
			return {
				kind: 'rejected',
				message: 'You have too many answers streaming — wait for one to finish.'
			};
		}
		const key = opts.conversationId ?? `new-${crypto.randomUUID()}`;
		const job = new StreamJob(key, opts.conversationId, opts.viewToken);
		this.jobs.set(key, job);
		if (!opts.conversationId) {
			// Optimistic sidebar entry; resolved to the real id at headers-time. If the
			// send dies before headers the entry is dropped — the server may still have
			// persisted the conversation, in which case the next full sidebar load
			// surfaces it.
			conversations.prepend({
				id: key,
				title: deriveTitle(text),
				updatedAt: Date.now(),
				pending: true
			});
		}
		let truncated = false;
		let serverError = false;
		let messageId: string | null = null;
		try {
			const res = await fetch('/api/ai/chat', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(
					opts.retry
						? { conversationId: opts.conversationId, retry: true }
						: {
								message: text,
								...(opts.conversationId ? { conversationId: opts.conversationId } : {})
							}
				),
				signal: job.controller.signal
			});
			if (!res.ok || !res.body) {
				const serverMessage = (await res.json().catch(() => null))?.message;
				if (!opts.conversationId) conversations.drop(key);
				this.#settle(job);
				return {
					kind: 'failed',
					message:
						res.status === 429 || res.status === 400 || res.status === 409
							? (serverMessage ?? 'That message could not be sent.')
							: res.status === 503
								? 'AI features are offline right now.'
								: res.status === 401
									? 'Your session expired — sign in again.'
									: res.status === 404
										? 'Conversation not found — start a new chat.'
										: 'The rules assistant is unavailable — try again in a minute.'
				};
			}
			const remainingHeader = res.headers.get('x-bp-ai-remaining');
			if (remainingHeader !== null) {
				const n = Number(remainingHeader);
				if (Number.isFinite(n)) this.remaining = n;
			}
			const cid = res.headers.get('x-bp-conversation-id');
			messageId = res.headers.get('x-bp-message-id');
			if (cid && !opts.conversationId) {
				// The server has persisted the conversation — swap in its real id.
				job.conversationId = cid;
				conversations.resolve(key, { id: cid, title: deriveTitle(text), updatedAt: Date.now() });
			} else if (cid) {
				conversations.touch(cid, Date.now());
			}
			this.#armStall(job);
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let lineBuffer = '';
			const handleLine = (line: string) => {
				if (!line) return;
				let msg: { t?: string; text?: string };
				try {
					msg = JSON.parse(line);
				} catch {
					return;
				}
				if (msg.t === 'think') job.thoughts += msg.text ?? '';
				else if (msg.t === 'text') job.streamingText += msg.text ?? '';
				else if (msg.t === 'truncated') truncated = true;
				else if (msg.t === 'error') serverError = true;
			};
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				this.#armStall(job);
				lineBuffer += decoder.decode(value, { stream: true });
				let newline: number;
				while ((newline = lineBuffer.indexOf('\n')) !== -1) {
					handleLine(lineBuffer.slice(0, newline));
					lineBuffer = lineBuffer.slice(newline + 1);
				}
			}
			lineBuffer += decoder.decode();
			handleLine(lineBuffer);
			if (serverError) {
				this.#finish(job, job.streamingText.trim() ? 'truncated' : 'error', messageId);
				return { kind: 'done', message: 'The assistant ran into a problem — try asking again.' };
			}
			if (!job.streamingText.trim()) {
				this.#finish(job, 'error', messageId);
				return { kind: 'done', message: 'No answer came back — try again.' };
			}
			this.#finish(job, truncated ? 'truncated' : 'complete', messageId);
			return {
				kind: 'done',
				message: truncated ? 'The answer was cut short — try asking again.' : null
			};
		} catch {
			// Pre-headers death (stop or network): the optimistic entry has no real id.
			if (!opts.conversationId && !messageId) conversations.drop(key);
			const wasStopped = job.controller.signal.aborted;
			if (job.streamingText.trim()) {
				// Keep the partial — it matches what the server persisted (truncated).
				this.#finish(job, 'truncated', messageId);
				return {
					kind: 'done',
					message: wasStopped
						? null
						: 'The connection dropped mid-answer — what arrived is shown above.'
				};
			}
			this.#settle(job);
			if (wasStopped) return { kind: 'done', message: null };
			if (messageId) {
				// Headers arrived, so the exchange is persisted server-side; restoring
				// the input would invite a duplicate retry.
				return { kind: 'done', message: 'The connection dropped — reload to see what was saved.' };
			}
			return { kind: 'failed', message: 'Network error — try again.' };
		}
	}
}

export const chatStream = new ChatStreamState();
