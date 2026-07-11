import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	timeout: 30_000,
	use: { baseURL: 'http://127.0.0.1:8787' },
	webServer: {
		command: process.env.CI
			? 'npm run db:migrate:local && npx wrangler dev --port 8787'
			: 'npm run build && npm run db:migrate:local && npx wrangler dev --port 8787',
		url: 'http://127.0.0.1:8787',
		reuseExistingServer: !process.env.CI,
		timeout: 180_000
	}
});
