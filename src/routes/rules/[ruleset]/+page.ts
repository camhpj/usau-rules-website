import { getManifest, listRulesets } from '$lib/content/load';
import { error } from '@sveltejs/kit';

export const entries = () => listRulesets().map((m) => ({ ruleset: m.id }));
export const load = ({ params }) => {
	try {
		return { manifest: getManifest(params.ruleset) };
	} catch {
		error(404, 'Unknown ruleset');
	}
};
