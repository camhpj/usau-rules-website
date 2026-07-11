import { createAuthClient } from 'better-auth/svelte';

/** Base URL defaults to the current origin — works on :5173 (vite) and :8787 (wrangler). */
export const authClient = createAuthClient();
