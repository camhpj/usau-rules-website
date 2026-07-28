const memory = new Map<string, string>();
/** Keys whose memory value never reached localStorage, so storage holds something older. */
const unpersisted = new Set<string>();

/** Test-only: clears the in-memory fallback between tests. */
export function __resetLocal(): void {
	memory.clear();
	unpersisted.clear();
}

// Even *referencing* localStorage can throw (sandboxed iframes, privacy-hardened
// configs) and it's undefined in node, so the entire access — reference and method
// call — lives inside the try/catch. No typeof guard: a ReferenceError is caught too.
export function readRaw(key: string): string | null {
	// A failed write leaves an older value in storage; memory is authoritative until
	// a write succeeds again.
	if (unpersisted.has(key)) return memory.get(key) ?? null;
	try {
		const value = localStorage.getItem(key);
		if (value !== null) return value;
	} catch {
		// localStorage unavailable or blocked — fall through to memory
	}
	return memory.get(key) ?? null;
}

export function writeRaw(key: string, value: string): void {
	memory.set(key, value);
	try {
		localStorage.setItem(key, value);
		unpersisted.delete(key);
	} catch {
		// Quota, unavailable, or blocked. Leave whatever is stored alone: for the sync
		// outbox it is the only copy that survives a reload.
		unpersisted.add(key);
	}
}
