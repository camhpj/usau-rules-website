import { onMount } from 'svelte';
import { authClient } from '$lib/auth-client';

type SessionUser = { name: string } | null;

/** Shared session state for a sign-in gate: subscribes to authClient.useSession()
 * and unsubscribes on unmount. */
class SessionGate {
	#user = $state<SessionUser>(null);
	#sessionReady = $state(false);

	constructor() {
		onMount(() => {
			const store = authClient.useSession();
			return store.subscribe((s) => {
				this.#user = s.data?.user ?? null;
				if (!s.isPending) this.#sessionReady = true;
			});
		});
	}

	get user(): SessionUser {
		return this.#user;
	}

	get sessionReady(): boolean {
		return this.#sessionReady;
	}

	signIn(callbackURL: string): void {
		void authClient.signIn.social({ provider: 'google', callbackURL });
	}
}

/**
 * Create a fresh session gate for one component instance.
 *
 * Must be called during component initialization — at the top level of a
 * <script>, not inside a callback, effect, or after an await — because the
 * constructor calls onMount internally. Calling it later fails at runtime
 * with "lifecycle_outside_component", not an error about this factory.
 */
export function createSessionGate(): SessionGate {
	return new SessionGate();
}
