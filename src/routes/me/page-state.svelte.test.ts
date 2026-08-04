import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MePageState, type Bookmark } from './page-state.svelte';

/** A promise plus its resolver, so a test can control exactly when a fetch settles. */
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

const mark = (ruleId: string, createdAt: number, rulesetId = 'r'): Bookmark => ({
	rulesetId,
	ruleId,
	createdAt,
	sectionSlug: null,
	sectionTitle: null
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('MePageState.removeBookmark', () => {
	// Bug proof: a naive fix that reverts by restoring `prev` (the array as it
	// was before this removal started) would also resurrect `x`, which a
	// *different*, already-confirmed removal took out while this request was
	// still in flight. The correct revert is computed from the live list, so
	// only the failed removal's own bookmark comes back, in its sorted slot.
	it('fails: the bookmark returns to its original position, and a concurrent removal of a different bookmark survives', async () => {
		const x = mark('x', 300);
		const a = mark('a', 200);
		const y = mark('y', 100);
		const state = new MePageState([x, a, y], null);
		const gate = deferred<Response>();
		fetchMock.mockReturnValueOnce(gate.promise);

		const pending = state.removeBookmark(a.rulesetId, a.ruleId);
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		// An unrelated, already-confirmed removal of `x` lands while `a`'s
		// DELETE is still in flight.
		state.marks = state.marks.filter((b) => b.ruleId !== 'x');

		gate.resolve(new Response(null, { status: 500 }));
		await pending;

		expect(state.marks).toEqual([a, y]);
		expect(state.errorMessage).toBe("Couldn't remove that bookmark — try again.");
	});

	// Bug proof: a naive snapshot-restore reverts to the array captured before
	// this removal began, discarding the concurrent addition of `c` entirely.
	it('fails: an unrelated bookmark added mid-flight survives', async () => {
		const a = mark('a', 200);
		const b = mark('b', 100);
		const c = mark('c', 50);
		const state = new MePageState([a, b], null);
		const gate = deferred<Response>();
		fetchMock.mockReturnValueOnce(gate.promise);

		const pending = state.removeBookmark(a.rulesetId, a.ruleId);
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		state.marks = [...state.marks, c]; // unrelated addition lands mid-flight

		gate.resolve(new Response(null, { status: 500 }));
		await pending;

		expect(state.marks).toEqual([a, b, c]);
	});

	it('succeeds: the bookmark stays removed and no error is set', async () => {
		const a = mark('a', 200);
		const b = mark('b', 100);
		const state = new MePageState([a, b], null);
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

		await state.removeBookmark(a.rulesetId, a.ruleId);

		expect(state.marks).toEqual([b]);
		expect(state.errorMessage).toBeNull();
	});

	// Bug proof: without the mutex, both calls read `marks` before either
	// request settles. The first call's failure then restores a snapshot taken
	// before the second call's now-successful delete, so the client ends up
	// showing the bookmark as present even though the server no longer has it.
	// Serializing means the second call's task doesn't start — and doesn't
	// read `marks` — until the first has fully settled (including its revert),
	// so exactly one outcome is possible: whichever request went out last.
	describe('two overlapping removals of the same key', () => {
		it('first fails, second succeeds: ends up removed', async () => {
			const a = mark('a', 200);
			const state = new MePageState([a], null);
			fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 })); // first DELETE fails
			fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 })); // second DELETE (sees the revert) succeeds

			const p1 = state.removeBookmark(a.rulesetId, a.ruleId);
			const p2 = state.removeBookmark(a.rulesetId, a.ruleId);
			await Promise.all([p1, p2]);

			expect(state.marks).toEqual([]);
			expect(fetchMock).toHaveBeenCalledTimes(2);
		});

		it('first succeeds, second is a no-op: stays removed', async () => {
			const a = mark('a', 200);
			const state = new MePageState([a], null);
			fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 })); // first DELETE succeeds
			fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 })); // second DELETE, already absent locally

			const p1 = state.removeBookmark(a.rulesetId, a.ruleId);
			const p2 = state.removeBookmark(a.rulesetId, a.ruleId);
			await Promise.all([p1, p2]);

			expect(state.marks).toEqual([]);
		});
	});

	it('clears a stale errorMessage when a new removal starts', async () => {
		const a = mark('a', 200);
		const b = mark('b', 100);
		const state = new MePageState([a, b], null);
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
		await state.removeBookmark(a.rulesetId, a.ruleId);
		expect(state.errorMessage).not.toBeNull();

		fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
		await state.removeBookmark(b.rulesetId, b.ruleId);

		expect(state.errorMessage).toBeNull();
	});

	it('is unaffected by a concurrent removal of a different key (runs concurrently, not serialized)', async () => {
		const a = mark('a', 200);
		const b = mark('b', 100);
		const state = new MePageState([a, b], null);
		fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

		await Promise.all([
			state.removeBookmark(a.rulesetId, a.ruleId),
			state.removeBookmark(b.rulesetId, b.ruleId)
		]);

		expect(state.marks).toEqual([]);
	});
});

describe('MePageState.removeName', () => {
	// Bug proof: the pre-fix component reverts `displayName` silently — there
	// is no `errorMessage` field for it to set, so the row just reappears with
	// no stated reason.
	it('fails: the name comes back and errorMessage is set', async () => {
		const state = new MePageState([], 'Alice');
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));

		await state.removeName();

		expect(state.displayName).toBe('Alice');
		expect(state.errorMessage).toBe("Couldn't remove your name — try again.");
	});

	it('succeeds: the name stays removed and no error is set', async () => {
		const state = new MePageState([], 'Alice');
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

		await state.removeName();

		expect(state.displayName).toBeNull();
		expect(state.errorMessage).toBeNull();
	});

	it('two overlapping removals: the second is a no-op once the first has settled', async () => {
		const state = new MePageState([], 'Alice');
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

		const p1 = state.removeName();
		const p2 = state.removeName();
		await Promise.all([p1, p2]);

		expect(state.displayName).toBeNull();
	});

	it('clears a stale errorMessage when a new removal starts', async () => {
		const state = new MePageState([], 'Alice');
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
		await state.removeName();
		expect(state.errorMessage).not.toBeNull();

		state.displayName = 'Bob'; // re-claimed after the failed removal
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
		await state.removeName();

		expect(state.errorMessage).toBeNull();
	});

	// Bug proof: `DisplayNameClaim`'s onSaved writes `displayName` directly,
	// outside this mutex — it is not a removal, so it never goes through
	// `#run`. An unguarded revert can't tell that apart from "nothing changed"
	// and clobbers the newer, server-confirmed name with the stale one this
	// removal captured before it started.
	it('fails, but a name claimed mid-flight (outside the mutex) survives the revert', async () => {
		const state = new MePageState([], 'Alice');
		const gate = deferred<Response>();
		fetchMock.mockReturnValueOnce(gate.promise);

		const pending = state.removeName();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(state.displayName).toBeNull(); // optimistic clear applied

		// DisplayNameClaim.onSaved fires while the removal's PUT is still in
		// flight, confirming a new name server-side and writing it directly.
		state.displayName = 'Bob';

		gate.resolve(new Response(null, { status: 500 }));
		await pending;

		expect(state.displayName).toBe('Bob');
	});
});
