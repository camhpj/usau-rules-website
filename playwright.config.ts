import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	timeout: 30_000,
	// Known-flake mitigation, CI only: e2e/ai.spec.ts's "seeded rows: real list scopes and
	// paginates; detail loads; DELETE soft-deletes; feedback writes" and e2e/admin.spec.ts's
	// "export: users CSV omits secrets; endpoint 404s for non-admin" have each intermittently
	// failed on a cold CI runner from D1/dev-server contention (see the `d1()` helpers in both
	// files). Local stays at 0 retries so a flake introduced during development still shows up
	// immediately instead of being silently retried away.
	retries: process.env.CI ? 2 : 0,
	// The suite shares ONE wrangler dev server + ONE local D1 sqlite file, and several
	// specs shell out to `wrangler d1 execute` to seed/read D1 mid-test. Concurrent
	// workers corrupt that shared state and crash the dev server (ECONNREFUSED cascade),
	// so the suite MUST run single-worker. CI happened to get this from low core counts;
	// pin it so many-core dev machines behave the same.
	workers: 1,
	use: { baseURL: 'http://127.0.0.1:8787' },
	webServer: {
		// Local runs reuse the on-disk D1 store across invocations (CI always starts from a
		// fresh checkout, so it never accumulates this). Left alone, throwaway e2e users and
		// their quiz_attempts pile up run after run until the leaderboard's top 10 is full of
		// real scores, which silently breaks tests like leaderboard.spec.ts's post-run nudge
		// (a fresh 0-score run can no longer rank in the top 10). Wipe local D1 state first so
		// every local e2e run starts from the same empty board CI gets for free.
		command: process.env.CI
			? 'npm run db:migrate:local && npx wrangler dev --port 8787'
			: 'rm -rf .wrangler/state/v3/d1 && npm run build && npm run db:migrate:local && npx wrangler dev --port 8787',
		url: 'http://127.0.0.1:8787',
		reuseExistingServer: !process.env.CI,
		timeout: 180_000
	}
});
