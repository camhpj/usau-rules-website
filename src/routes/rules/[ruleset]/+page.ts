import { listRulesets } from '$lib/content/load';
import { redirect } from '@sveltejs/kit';

export const entries = () => listRulesets().map((m) => ({ ruleset: m.id }));
export const load = () => redirect(308, '/rules');
