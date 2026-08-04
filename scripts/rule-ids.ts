import type { RuleNode, Section } from '../src/lib/content/types';

/** Every rule id (all depths) plus every section anchor id. */
export function collectRuleIds(sections: Section[]): Set<string> {
	const ids = new Set<string>();
	const walk = (nodes: RuleNode[]) => {
		for (const node of nodes) {
			ids.add(node.id);
			walk(node.children);
		}
	};
	for (const section of sections) {
		ids.add(section.anchorId);
		walk(section.rules);
	}
	return ids;
}
