import { describe, expect, it, vi } from 'vitest';
import { createOptimistic } from './optimistic';

/** A promise plus its resolver, so a test can control exactly when `request` settles. */
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

describe('createOptimistic', () => {
	it('runs apply and never reverts on success', async () => {
		const optimistic = createOptimistic();
		const apply = vi.fn();
		const revert = vi.fn();

		const ok = await optimistic('k', { apply, revert, request: () => Promise.resolve(true) });

		expect(ok).toBe(true);
		expect(apply).toHaveBeenCalledOnce();
		expect(revert).not.toHaveBeenCalled();
	});

	it('runs apply then revert on failure', async () => {
		const optimistic = createOptimistic();
		const apply = vi.fn();
		const revert = vi.fn();

		const ok = await optimistic('k', { apply, revert, request: () => Promise.resolve(false) });

		expect(ok).toBe(false);
		expect(apply).toHaveBeenCalledOnce();
		expect(revert).toHaveBeenCalledOnce();
	});

	it('suppresses a stale revert once a newer mutation for the same key has started', async () => {
		const optimistic = createOptimistic();
		const a = deferred<boolean>();
		const b = deferred<boolean>();
		const revertA = vi.fn();
		const revertB = vi.fn();

		// A starts, then B starts on the same key before A's request resolves.
		const pendingA = optimistic('k', {
			apply: vi.fn(),
			revert: revertA,
			request: () => a.promise
		});
		const pendingB = optimistic('k', {
			apply: vi.fn(),
			revert: revertB,
			request: () => b.promise
		});

		// A fails, but B has already superseded it for this key.
		a.resolve(false);
		expect(await pendingA).toBe(false);
		expect(revertA).not.toHaveBeenCalled();

		b.resolve(true);
		await pendingB;
	});

	it('leaves a different key unaffected by another key failing', async () => {
		const optimistic = createOptimistic();
		const b = deferred<boolean>();
		const applyB = vi.fn();
		const revertB = vi.fn();

		const pendingB = optimistic('k2', { apply: applyB, revert: revertB, request: () => b.promise });

		const okA = await optimistic('k1', {
			apply: vi.fn(),
			revert: vi.fn(),
			request: () => Promise.resolve(false)
		});
		expect(okA).toBe(false);

		// k2's own outcome and revert are driven only by its own request.
		b.resolve(false);
		const okB = await pendingB;
		expect(okB).toBe(false);
		expect(applyB).toHaveBeenCalledOnce();
		expect(revertB).toHaveBeenCalledOnce();
	});

	it("reverts the newest mutation's own failure, even after an earlier one on the same key was suppressed", async () => {
		const optimistic = createOptimistic();
		const a = deferred<boolean>();
		const b = deferred<boolean>();
		const revertA = vi.fn();
		const revertB = vi.fn();

		const pendingA = optimistic('k', {
			apply: vi.fn(),
			revert: revertA,
			request: () => a.promise
		});
		const pendingB = optimistic('k', {
			apply: vi.fn(),
			revert: revertB,
			request: () => b.promise
		});

		a.resolve(false);
		await pendingA;
		expect(revertA).not.toHaveBeenCalled();

		b.resolve(false);
		await pendingB;
		expect(revertB).toHaveBeenCalledOnce();
	});
});
