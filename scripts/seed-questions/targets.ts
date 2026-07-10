import type { RuleNode, Section } from '../../src/lib/content/types';
import type { Question } from '../../src/lib/quiz/types';

export interface Target {
	id: string; // rule id, e.g. "15.F"
	sectionSlug: string;
	score: number;
	text: string; // the rule's own text
}

/** In-degree: how many times each rule id appears in other rules' refs[] across all sections. */
export function computeInDegree(sections: Section[]): Map<string, number> {
	const inDegree = new Map<string, number>();
	const walk = (nodes: RuleNode[]) => {
		for (const node of nodes) {
			for (const ref of node.refs) {
				inDegree.set(ref, (inDegree.get(ref) ?? 0) + 1);
			}
			walk(node.children);
		}
	};
	for (const section of sections) walk(section.rules);
	return inDegree;
}

function depthBonus(depth: number): number {
	if (depth === 0) return 3;
	if (depth === 1) return 1;
	return 0;
}

/**
 * Importance-ranked target set (descending score).
 * score = 2*inDegree + 2*ownAnnotationCount + depthBonus (depth 0: +3, depth 1: +1, deeper: 0).
 * A rule is a target iff: score >= threshold AND rule.text.length >= minTextLength
 * AND id not in exclude. Bare headers (short text) are excluded — they're covered via children.
 */
export function computeTargets(
	sections: Section[],
	opts: { threshold: number; minTextLength: number; exclude: string[] }
): Target[] {
	const inDegree = computeInDegree(sections);
	const exclude = new Set(opts.exclude);
	const targets: Target[] = [];
	const walk = (nodes: RuleNode[], sectionSlug: string, depth: number) => {
		for (const node of nodes) {
			const score =
				2 * (inDegree.get(node.id) ?? 0) + 2 * node.annotations.length + depthBonus(depth);
			if (
				score >= opts.threshold &&
				node.text.length >= opts.minTextLength &&
				!exclude.has(node.id)
			) {
				targets.push({ id: node.id, sectionSlug, score, text: node.text });
			}
			walk(node.children, sectionSlug, depth + 1);
		}
	};
	for (const section of sections) walk(section.rules, section.slug, 0);
	return targets.sort((a, b) => b.score - a.score);
}

/**
 * A target is covered iff any question cites the target id or a descendant
 * (ref === id || ref.startsWith(id + '.')). Returns uncovered targets, order preserved.
 */
export function uncoveredTargets(targets: Target[], questions: Question[]): Target[] {
	const refs = new Set(questions.flatMap((q) => q.ruleRefs));
	const isCovered = (id: string) => {
		for (const ref of refs) {
			if (ref === id || ref.startsWith(id + '.')) return true;
		}
		return false;
	};
	return targets.filter((target) => !isCovered(target.id));
}
