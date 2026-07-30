import { describe, expect, it } from 'vitest';
import { createKeyedMutex } from './optimistic';

/** A promise plus its resolver, so a test can control exactly when a task settles. */
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

describe('createKeyedMutex', () => {
	it('resolves with the task result', async () => {
		const run = createKeyedMutex();
		const value = await run('k', () => Promise.resolve(42));
		expect(value).toBe(42);
	});

	it('propagates a task rejection to its own caller', async () => {
		const run = createKeyedMutex();
		const err = new Error('boom');
		await expect(run('k', () => Promise.reject(err))).rejects.toBe(err);
	});

	it('does not start a same-key task until the previous one has settled', async () => {
		const run = createKeyedMutex();
		const order: string[] = [];
		const a = deferred<void>();

		const pendingA = run('k', async () => {
			order.push('a-start');
			await a.promise;
			order.push('a-end');
		});
		const pendingB = run('k', async () => {
			order.push('b-start');
		});

		// Let several microtask turns pass — B must still not have started,
		// because A hasn't settled.
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(order).toEqual(['a-start']);

		a.resolve();
		await Promise.all([pendingA, pendingB]);
		expect(order).toEqual(['a-start', 'a-end', 'b-start']);
	});

	it('runs a different key concurrently, unblocked by a pending key', async () => {
		const run = createKeyedMutex();
		const a = deferred<void>();
		const order: string[] = [];

		const pendingA = run('k1', async () => {
			order.push('a-start');
			await a.promise;
			order.push('a-end');
		});
		const pendingB = run('k2', async () => {
			order.push('b-start-and-end');
		});

		await pendingB;
		expect(order).toEqual(['a-start', 'b-start-and-end']);

		a.resolve();
		await pendingA;
	});

	it('runs the next same-key task even after the previous one rejects', async () => {
		const run = createKeyedMutex();
		const first = run('k', () => Promise.reject(new Error('fails')));
		first.catch(() => {}); // the mutex must not require this to unblock the queue

		const second = await run('k', () => Promise.resolve('ok'));
		expect(second).toBe('ok');
	});
});
