import { z } from 'zod';
import { QuestionSchema, type Question } from './types';

// Non-eager: only the file paths land in the bundle. Each section's questions are
// a separate chunk, fetched when a quiz that needs it starts.
const files = import.meta.glob('$content/questions/*/*.json') as Record<
	string,
	() => Promise<{ default: unknown }>
>;

const cache = new Map<string, Question[]>();

async function loadFile(path: string): Promise<Question[]> {
	const cached = cache.get(path);
	if (cached) return cached;
	const parsed = z.array(QuestionSchema).parse((await files[path]()).default);
	cache.set(path, parsed);
	return parsed;
}

export async function loadSectionQuestions(
	rulesetId: string,
	sectionSlug: string
): Promise<Question[]> {
	const path = Object.keys(files).find((p) =>
		p.endsWith(`/questions/${rulesetId}/${sectionSlug}.json`)
	);
	return path ? loadFile(path) : [];
}

// Exported so a test can exercise the sort against input that isn't already
// sorted. `import.meta.glob` hands `loadAllQuestions` its paths pre-sorted
// (Vite sorts glob matches before inlining them), so calling this on the real
// `files` keys is currently a no-op — this call is defense against relying on
// that as a permanent guarantee, not against today's observed behavior.
export function sortQuestionPaths(paths: string[]): string[] {
	return [...paths].sort();
}

export async function loadAllQuestions(rulesetId: string): Promise<Question[]> {
	// Sorted by path so the seeded shuffle in engine.ts stays reproducible.
	const paths = sortQuestionPaths(
		Object.keys(files).filter((p) => p.includes(`/questions/${rulesetId}/`))
	);
	const loaded = await Promise.all(paths.map(loadFile));
	return loaded.flat();
}
