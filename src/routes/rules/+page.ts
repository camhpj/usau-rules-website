import { listRulesets } from '$lib/content/load';

export const load = () => ({ rulesets: listRulesets() });
