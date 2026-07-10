import { getManifest, getSection, getGlossary, listRulesets } from '$lib/content/load';
import { error } from '@sveltejs/kit';

export const entries = () =>
	listRulesets().flatMap((m) => m.sections.map((s) => ({ ruleset: m.id, section: s.slug })));

export const load = ({ params }) => {
	try {
		const manifest = getManifest(params.ruleset);
		return {
			manifest,
			section: getSection(params.ruleset, params.section),
			glossary: getGlossary(params.ruleset)
		};
	} catch {
		error(404, 'Unknown section');
	}
};
