// Lazy glob: only the file PATHS land in the rules-page bundle, not the question JSON.
const files = import.meta.glob('$content/questions/*/*.json');

export function hasQuestions(rulesetId: string, sectionSlug: string): boolean {
	return Object.keys(files).some((path) =>
		path.endsWith(`/questions/${rulesetId}/${sectionSlug}.json`)
	);
}
