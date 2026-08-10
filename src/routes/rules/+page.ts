import { getManifest } from '$lib/content/load';
import { DEFAULT_RULESET_ID } from '$lib/content/config';

export const load = () => ({ manifest: getManifest(DEFAULT_RULESET_ID) });
