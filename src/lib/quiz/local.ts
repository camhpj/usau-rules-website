const memory = new Map<string, string>();

/** Test-only: clears the in-memory fallback between tests. */
export function __resetLocal(): void {
	memory.clear();
}

// Even *referencing* localStorage can throw (sandboxed iframes, privacy-hardened
// configs) and it's undefined in node, so the entire access — reference and method
// call — lives inside the try/catch. No typeof guard: a ReferenceError is caught too.
export function readRaw(key: string): string | null {
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
	} catch {
		// unavailable/quota/blocked — memory fallback already holds the value
	}
}
