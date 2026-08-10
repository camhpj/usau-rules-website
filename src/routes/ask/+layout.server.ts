import type { LayoutServerLoad } from './$types';
import { allowTestSignIn } from '$lib/server/dev-signin';

// /ask is already excluded from prerendering (see ask/[[id]]/+page.ts), so this
// runs per-request on the worker, where `platform.env` reflects real config —
// never at build time, where it would be unavailable.
export const load: LayoutServerLoad = (event) => ({
	allowTestSignIn: allowTestSignIn(event.platform?.env)
});
