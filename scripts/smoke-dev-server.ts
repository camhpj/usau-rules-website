// Smoke-tests `npm run dev` itself. Unit tests import modules directly, and
// `npm run test:e2e` runs a production build (`npm run build && wrangler dev`), so neither
// exercises the dev server. Tranche 2 changed src/lib/content/load.ts to a non-eager
// `import.meta.glob`. A production build bundles those globs away, but under `npm run dev`
// each section becomes a lazy `import()` the browser fetches from Vite over HTTP, and
// `content/` sat outside `server.fs.allow` — the fetch got a 403 and CI stayed green while
// every rule section broke on the owner's machine. This script would have caught it.
//
// A plain curl of the page does NOT reproduce this: SvelteKit's universal `load` runs once
// on the server for the initial render (in-process, no HTTP round trip, so `fs.allow` never
// sees it) and *again* in the browser right after hydration. It's that second, client-side
// run that issues the real HTTP request `fs.allow` gates. So this drives an actual headless
// browser through hydration rather than asserting on the raw HTTP response — a bare fetch
// looks healthy right up until the point this bug exists.
//
// It does not assert on a 200. The broken build still serves *a* page — the section content
// fails underneath it, after hydration replaces the server-rendered content with a 404.
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium } from '@playwright/test';

const PORT = 5183; // distinct from vite's default (5173) and wrangler's (8787, see playwright.config.ts)
// `localhost`, not `127.0.0.1`: vite dev binds only the IPv6 loopback (`::1`) unless
// `--host` is passed, so an IPv4-literal fetch gets ECONNREFUSED even once the server is up.
const BASE_URL = `http://localhost:${PORT}`;
const TARGET_PATH = '/rules/usau-official-2026-27/2';
// Spirit of the Game's three tenets, verbatim from
// content/rulesets/usau-official-2026-27/sections/2.json (rule 2.A). It's core doctrine of
// the sport rather than incidental prose, so it's about as unlikely as any string in the
// ruleset to be reworded when content is regenerated, and it renders with no <dfn> markup
// splitting it up.
const EXPECTED_TEXT =
	'mutual respect among competitors, adherence to the agreed upon rules, and the basic joy of play';
const STARTUP_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 1_000;
const FETCH_TIMEOUT_MS = 5_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let devServer: ChildProcess | undefined;
let output = '';

async function killDevServer(): Promise<void> {
	const proc = devServer;
	if (!proc || proc.pid === undefined || proc.exitCode !== null || proc.signalCode !== null) return;
	const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()));
	try {
		// `npm run dev` spawns vite as a child; detached:true put it in its own process
		// group (pgid === proc.pid), so signal the whole group, not just the npm wrapper.
		process.kill(-proc.pid, 'SIGTERM');
	} catch {
		return; // already gone
	}
	const timedOut = await Promise.race([exited.then(() => false), sleep(5_000).then(() => true)]);
	if (timedOut) {
		try {
			process.kill(-proc.pid, 'SIGKILL');
		} catch {
			// already gone
		}
	}
}

// Poll with plain fetch until the dev server accepts a connection at all. Playwright's
// page.goto does not retry a refused connection, and vite's startup time is a cold-boot
// variable we don't want to guess with a fixed sleep.
async function waitForServerUp(): Promise<void> {
	const deadline = Date.now() + STARTUP_TIMEOUT_MS;
	let lastError: unknown;
	while (Date.now() < deadline) {
		if (devServer?.exitCode !== null && devServer?.exitCode !== undefined) {
			throw new Error(
				`dev server exited early with code ${devServer.exitCode}\n--- output ---\n${output.slice(-4000)}`
			);
		}
		try {
			await fetch(BASE_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
			return;
		} catch (err) {
			lastError = err;
			await sleep(POLL_INTERVAL_MS);
		}
	}
	throw new Error(
		`dev server never answered at ${BASE_URL} within ${STARTUP_TIMEOUT_MS}ms (last error: ${String(lastError)})`
	);
}

async function main(): Promise<number> {
	const start = Date.now();
	devServer = spawn('npm', ['run', 'dev', '--', '--port', String(PORT), '--strictPort'], {
		cwd: process.cwd(),
		detached: true,
		stdio: ['ignore', 'pipe', 'pipe']
	});
	devServer.stdout?.on('data', (d: Buffer) => (output += d.toString()));
	devServer.stderr?.on('data', (d: Buffer) => (output += d.toString()));

	await waitForServerUp();

	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		await page.goto(`${BASE_URL}${TARGET_PATH}`, {
			waitUntil: 'load',
			timeout: FETCH_TIMEOUT_MS * 2
		});
		// Let hydration finish and run its client-side copy of the universal `load` —
		// that's the request `fs.allow` actually gates. networkidle means it has settled
		// either way (fetched the section fine, or failed and rendered the 404 fallback).
		await page.waitForLoadState('networkidle', { timeout: STARTUP_TIMEOUT_MS });
		const bodyText = await page.locator('body').innerText();
		const elapsed = ((Date.now() - start) / 1000).toFixed(1);

		if (!bodyText.includes(EXPECTED_TEXT)) {
			console.error(
				`FAIL (${elapsed}s): rule text missing from ${BASE_URL}${TARGET_PATH} after hydration`
			);
			console.error(`  expected substring: ${JSON.stringify(EXPECTED_TEXT)}`);
			console.error(`  visible body text (first 500 chars): ${bodyText.slice(0, 500)}`);
			return 1;
		}
		console.log(`OK (${elapsed}s): ${TARGET_PATH} rendered real rule content under npm run dev`);
		return 0;
	} finally {
		await browser.close();
	}
}

process.on('SIGINT', () => void killDevServer().finally(() => process.exit(130)));
process.on('SIGTERM', () => void killDevServer().finally(() => process.exit(143)));

main()
	.catch((err: unknown) => {
		console.error(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
		return 1;
	})
	.then(async (code) => {
		await killDevServer();
		process.exit(code);
	});
