import { execSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, signInAsAdmin, signUpTestUser } from './helpers';

const d1 = (sql: string): unknown =>
	JSON.parse(
		execSync(
			`npx wrangler d1 execute usau-rules-website-db --local --json --command "${sql.replace(/"/g, '\\"')}"`,
			{ cwd: process.cwd(), encoding: 'utf-8' }
		)
	);
const d1Select = (sql: string): Record<string, unknown>[] =>
	(d1(sql) as { results: Record<string, unknown>[] }[])[0].results;

test.describe('admin access', () => {
	test('signed out → 404 on admin routes', async ({ page }) => {
		for (const path of ['/admin', '/admin/ai', '/admin/export']) {
			const res = await page.goto(path);
			expect(res?.status(), path).toBe(404);
		}
	});

	test('non-admin signed in → 404', async ({ page }) => {
		await signUpTestUser(page, 'not-admin');
		const res = await page.goto('/admin');
		expect(res?.status()).toBe(404);
	});

	test('admin → dashboard renders', async ({ page }) => {
		await signInAsAdmin(page);
		await page.goto('/admin');
		await expect(page.getByRole('heading', { name: 'Admin' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'AI review' })).toBeVisible();
	});

	test('dashboard reflects seeded data', async ({ page }) => {
		await signInAsAdmin(page);
		// seed a conversation + a thumbed-down assistant message for this admin user
		const uid = (
			d1Select(`SELECT id FROM user WHERE email = '${ADMIN_EMAIL}'`)[0] as { id: string }
		).id;
		d1(
			`INSERT INTO ai_conversations (id,user_id,ruleset_id,title,created_at,updated_at) VALUES ('c-metrics','${uid}','usau-official-2026-27','seed',1,1)`
		);
		d1(
			`INSERT INTO ai_messages (id,conversation_id,role,content,status,feedback,created_at) VALUES ('m-a','c-metrics','assistant','ans','complete','down',2)`
		);
		await page.goto('/admin');
		await expect(page.getByText('Conversations')).toBeVisible();
		// downRatio tile shows 100.0% when the only feedback row is a down
		await expect(page.getByText('100.0%').first()).toBeVisible();
	});
});

test('AI review: 👎 filter and cross-user transcript', async ({ page }) => {
	await signInAsAdmin(page);
	// a DIFFERENT user's conversation with a 👎 assistant message
	const other = (d1Select(`SELECT id FROM user LIMIT 1`)[0] as { id: string }).id;
	d1(
		`INSERT INTO ai_conversations (id,user_id,ruleset_id,title,created_at,updated_at) VALUES ('c-ai','${other}','usau-official-2026-27','stall count question',10,10)`
	);
	d1(
		`INSERT INTO ai_messages (id,conversation_id,role,content,created_at) VALUES ('m-u','c-ai','user','what is a stall?',10)`
	);
	d1(
		`INSERT INTO ai_messages (id,conversation_id,role,content,status,feedback,created_at) VALUES ('m-r','c-ai','assistant','A stall per 15.D.','complete','down',11)`
	);
	d1(
		`INSERT INTO ai_conversations (id,user_id,ruleset_id,title,created_at,updated_at) VALUES ('c-nodown','${other}','usau-official-2026-27','no-down conversation',12,12)`
	);
	d1(
		`INSERT INTO ai_messages (id,conversation_id,role,content,status,feedback,created_at) VALUES ('m-nd','c-nodown','assistant','fine answer','complete','up',13)`
	);

	await page.goto('/admin/ai?down=1');
	await expect(page.getByRole('link', { name: 'stall count question' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'no-down conversation' })).toHaveCount(0);

	await page.getByRole('link', { name: 'stall count question' }).click();
	await expect(page.getByText('what is a stall?')).toBeVisible();
	await expect(page.getByText('👎')).toBeVisible();
});
