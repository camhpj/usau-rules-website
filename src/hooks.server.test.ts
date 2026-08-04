import { describe, expect, test } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { isDynamicRoute } from './hooks.server';

// Guards against the bug class this file exists for: a new server route added
// under src/routes that `isDynamicRoute` (src/hooks.server.ts) does not match.
// Such a route compiles and passes review, then throws at runtime the first
// time it touches `locals.db` / `locals.auth`, because `handle` never
// populated them for that path. This test discovers server routes from the
// filesystem — never from a copy of the allowlist — so it fails the moment a
// route and the allowlist disagree, in either direction.

const ROUTES_DIR = join(__dirname, 'routes');

// Only these file kinds run server-side and can read `event.locals`.
// `+page.ts` / `+layout.ts` are universal (client + server) and out of scope.
const SERVER_FILE_NAMES = new Set(['+server.ts', '+page.server.ts', '+layout.server.ts']);

function findServerRouteFiles(dir: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			found.push(...findServerRouteFiles(full));
		} else if (SERVER_FILE_NAMES.has(entry.name)) {
			found.push(full);
		}
	}
	return found;
}

// Converts one path segment (a directory name under src/routes) to the piece
// of the URL it contributes. Handles every SvelteKit routing convention
// present in this repo, plus two (optional and rest params) that do not
// currently appear under +server.ts / +page.server.ts / +layout.server.ts but
// are cheap to support correctly rather than silently mishandle later.
function segmentToUrlPart(segment: string): string | null {
	// Route group, e.g. "(app)" — organizational only, contributes nothing to
	// the URL. None exist in this repo today, but the syntax is unambiguous.
	if (/^\([^)]*\)$/.test(segment)) return null;

	let part = segment;
	// Optional param, e.g. "[[id]]" (seen in src/routes/ask/[[id]]/+page.ts,
	// which is a +page.ts and so outside this test's scope, but the pattern
	// could reach a +page.server.ts later). Must run before the rest/ordinary
	// replacements below, or they would each consume one bracket layer and
	// leave stray brackets behind.
	part = part.replace(/\[\[[^\]]*\]\]/g, 'x');
	// Rest param, e.g. "[...rest]".
	part = part.replace(/\[\.\.\.[^\]]*\]/g, 'x');
	// Ordinary or matcher-qualified param, e.g. "[id]", "[id=integer]". Also
	// covers the combined form seen at
	// src/routes/admin/export/[dataset].csv/+server.ts, where the bracket is
	// only part of the segment ("[dataset].csv" -> "x.csv").
	part = part.replace(/\[[^\]]*\]/g, 'x');
	return part;
}

function filePathToUrlPath(absoluteFilePath: string): string {
	const relativeDir = dirname(relative(ROUTES_DIR, absoluteFilePath));
	if (relativeDir === '.') return '/';
	const segments = relativeDir
		.split('/')
		.map(segmentToUrlPart)
		.filter((part): part is string => part !== null);
	return '/' + segments.join('/');
}

const discoveredFiles = findServerRouteFiles(ROUTES_DIR);
const discoveredRoutes = discoveredFiles.map((file) => ({
	file: relative(ROUTES_DIR, file),
	urlPath: filePathToUrlPath(file)
}));

// These +page.server.ts files inherit `prerender = true` from the root layout
// (src/routes/+layout.ts) and do not opt out, so SvelteKit bakes their load
// output into static assets at build time. In production they never reach the
// worker (see the comment above `isDynamicRoute`), so `isDynamicRoute`
// correctly returns false for them — that is not a gap in the allowlist. Each
// file says as much in its own comment ("Runs at build time: this route
// prerenders...").
const PRERENDERED_EXCEPTIONS = new Set([
	'quiz/+page.server.ts',
	'quiz/mastery/+page.server.ts',
	'quiz/quick/+page.server.ts'
]);

describe('route discovery', () => {
	// A regression guard on the walk itself: if this drops to 0, every test
	// below vacuously passes and the suite stops proving anything.
	test('finds server route files under src/routes', () => {
		expect(discoveredFiles.length).toBeGreaterThanOrEqual(22);
	});
});

describe('isDynamicRoute matches every server route that needs locals.db/auth', () => {
	const dynamicRoutes = discoveredRoutes.filter((r) => !PRERENDERED_EXCEPTIONS.has(r.file));

	test.each(dynamicRoutes)('$file -> $urlPath', ({ urlPath }) => {
		expect(isDynamicRoute(urlPath)).toBe(true);
	});
});

describe('prerendered exceptions stay prerendered', () => {
	// If one of these ever adds `export const prerender = false`, it starts
	// running on the worker on every request and needs `locals.db` /
	// `locals.auth` like any other dynamic route — at which point it belongs
	// in the allowlist too. This catches that flip instead of leaving these
	// three paths permanently exempt.
	test.each([...PRERENDERED_EXCEPTIONS])('%s does not opt out of prerendering', (file) => {
		const source = readFileSync(join(ROUTES_DIR, file), 'utf-8');
		expect(source).not.toMatch(/prerender\s*=\s*false/);
	});

	// The check above only reads the excepted files themselves, but prerendering
	// is inherited: a `+layout.ts` anywhere above one of them can opt the whole
	// subtree out, and this repo already uses that pattern (ask/[[id]]/+page.ts).
	// So also pin the two places the inheritance could change.
	test('the root layout still turns prerendering on', () => {
		expect(readFileSync(join(ROUTES_DIR, '+layout.ts'), 'utf-8')).toMatch(/prerender\s*=\s*true/);
	});

	test('no layout above an excepted route opts its subtree out', () => {
		for (const file of PRERENDERED_EXCEPTIONS) {
			// Walk each ancestor directory of the excepted route, checking any
			// layout that would apply to it.
			const parts = file.split('/').slice(0, -1);
			for (let i = parts.length; i >= 0; i--) {
				for (const layout of ['+layout.ts', '+layout.server.ts']) {
					const candidate = join(ROUTES_DIR, ...parts.slice(0, i), layout);
					if (!existsSync(candidate)) continue;
					expect(readFileSync(candidate, 'utf-8'), candidate).not.toMatch(/prerender\s*=\s*false/);
				}
			}
		}
	});
});
