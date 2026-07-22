import { execSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { signUpTestUser } from './helpers';

// Shells out to wrangler against the same local D1 sqlite file the dev server uses. This is
// only safe because the e2e suite runs single-worker (playwright.config.ts has no explicit
// `workers` override for a single spec file) — concurrent writers against the same local D1
// file are not something these helpers attempt to coordinate.
const d1 = (sql: string): unknown =>
	JSON.parse(
		execSync(
			`npx wrangler d1 execute usau-rules-website-db --local --json --command "${sql.replace(/"/g, '\\"')}"`,
			{ cwd: process.cwd(), encoding: 'utf-8' }
		)
	);
const d1Select = (sql: string): Record<string, unknown>[] =>
	(d1(sql) as { results: Record<string, unknown>[] }[])[0].results;

export const AI_QUESTION = {
	id: 'ai-11111111-1111-1111-1111-111111111111',
	rulesetId: 'usau-official-2026-27',
	type: 'multiple-choice',
	prompt:
		'Mid-point, the marker reaches “ten” in the stall count while the thrower still holds the disc. Two teammates argue about the restart. What is the ruling?',
	choices: [
		'It is a turnover — the marker announces “stall” and play stops.',
		'The count restarts at eight.',
		'The thrower gets a warning first.',
		'Play continues until a pass is attempted.'
	],
	answerIndex: 0,
	explanation: 'Per 15.D, reaching “ten” before the release is a stall — a turnover.',
	ruleRefs: ['15.D'],
	sectionSlug: '15',
	difficulty: 1
};

test.describe('scenario mode', () => {
	test('signed out: shows the sign-in gate, no deal button', async ({ page }) => {
		await page.goto('/quiz/scenario');
		await page.waitForLoadState('networkidle');
		await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
		await expect(page.getByRole('button', { name: /deal a scenario/i })).toHaveCount(0);
	});

	test('signed in: deals, plays, and can deal another', async ({ page }) => {
		await signUpTestUser(page, 'scenario');
		await page.route('**/api/ai/scenario', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ source: 'ai', remaining: 9, question: AI_QUESTION })
			})
		);
		await page.goto('/quiz/scenario');
		await page.waitForLoadState('networkidle');
		await page.getByRole('button', { name: /deal a scenario/i }).click();
		await expect(page.getByText(/stall count/)).toBeVisible();
		await page.getByRole('button', { name: /it is a turnover/i }).click();
		await expect(page.getByText(/per 15\.D/i)).toBeVisible();
		await page.getByRole('button', { name: 'Continue', exact: true }).click();
		await expect(page.getByRole('button', { name: /another scenario/i })).toBeVisible();
		await expect(page.getByText(/9 scenarios left today/i)).toBeVisible();

		await page.goto('/quiz');
		await expect(page.getByText(/9 scenarios left today/i)).toBeVisible();
	});

	test('daily limit: 429 surfaces the message', async ({ page }) => {
		await signUpTestUser(page, 'scenario-limit');
		await page.route('**/api/ai/scenario', (route) =>
			route.fulfill({
				status: 429,
				contentType: 'application/json',
				body: JSON.stringify({ message: 'Daily scenario limit reached — try again tomorrow' })
			})
		);
		await page.goto('/quiz/scenario');
		await page.waitForLoadState('networkidle');
		await page.getByRole('button', { name: /deal a scenario/i }).click();
		await expect(page.getByText(/daily scenario limit reached/i)).toBeVisible();
	});

	test('fallback: bank question is labeled', async ({ page }) => {
		await signUpTestUser(page, 'scenario-fb');
		await page.route('**/api/ai/scenario', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					source: 'fallback',
					remaining: 8,
					question: { ...AI_QUESTION, id: '15-01' }
				})
			})
		);
		await page.goto('/quiz/scenario');
		await page.waitForLoadState('networkidle');
		await page.getByRole('button', { name: /deal a scenario/i }).click();
		await expect(page.getByText(/AI was unavailable/i)).toBeVisible();
	});
});

const CHAT_STREAM = (convoId: string, messageId: string) => ({
	status: 200,
	headers: {
		'content-type': 'application/x-ndjson; charset=utf-8',
		'x-bp-ai-remaining': '9',
		'x-bp-conversation-id': convoId,
		'x-bp-message-id': messageId
	},
	body: '{"t":"think","text":"**Checking the stall rules**"}\n{"t":"text","text":"Yes — per [15.D] that is a turnover. "}\n{"t":"text","text":"[99.ZZ] is not a real rule."}\n'
});

test.describe('ask the rules (chat)', () => {
	test('signed out: sign-in gate, no message box', async ({ page }) => {
		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
		await expect(page.getByRole('textbox')).toHaveCount(0);
	});

	test('send streams an answer, URL becomes /ask/<id>, sidebar lists it, follow-up appends', async ({
		page
	}) => {
		await signUpTestUser(page, 'chat');
		let calls = 0;
		await page.route('**/api/ai/chat', (route) => {
			calls += 1;
			return route.fulfill(CHAT_STREAM('mock-convo-1', `mock-msg-${calls}`));
		});
		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		await page.getByRole('textbox', { name: 'Your message' }).fill('Is it a stall at ten?');
		await page.getByRole('button', { name: /^send$/i }).click();
		await expect(page.getByText(/that is a turnover/).first()).toBeVisible();
		const link = page.getByRole('link', { name: '15.D' }).first();
		await expect(link).toHaveAttribute('href', '/rules/usau-official-2026-27/15#15.D');
		await expect(page).toHaveURL(/\/ask\/mock-convo-1$/);
		await expect(
			page.getByRole('navigation', { name: 'Conversations' }).getByText(/is it a stall at ten\?/i)
		).toBeVisible();
		await expect(page.getByText(/9 questions left today/)).toBeVisible();

		// Follow-up appends in place (still 1 page, now 2 exchanges).
		await page.getByRole('textbox', { name: 'Your message' }).fill('And what about nine?');
		await page.getByRole('button', { name: /^send$/i }).click();
		await expect(page.getByText('And what about nine?')).toBeVisible();
		await expect(page.getByText(/that is a turnover/)).toHaveCount(2);
	});

	test('a new conversation appears in the sidebar the moment it is sent', async ({ page }) => {
		await signUpTestUser(page, 'chat-optimistic');
		let releaseFulfill: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			releaseFulfill = resolve;
		});
		await page.route('**/api/ai/chat', async (route) => {
			await gate;
			await route.fulfill(CHAT_STREAM('mock-convo-optimistic', 'mock-msg-optimistic'));
		});
		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		await page.getByRole('textbox', { name: 'Your message' }).fill('Is it a stall at ten?');
		await page.getByRole('button', { name: /^send$/i }).click();

		const sidebar = page.getByRole('navigation', { name: 'Conversations' });
		// The entry appears immediately — before headers, let alone the stream, arrive — as a
		// non-clickable placeholder.
		await expect(sidebar.getByText(/is it a stall at ten\?/i)).toBeVisible();
		await expect(sidebar.getByText('Sending…')).toBeVisible();
		await expect(sidebar.getByRole('link', { name: /is it a stall at ten\?/i })).toHaveCount(0);

		releaseFulfill();
		// Headers arrive: the placeholder resolves into a real link to the conversation.
		await expect(sidebar.getByRole('link', { name: /is it a stall at ten\?/i })).toBeVisible();
		await expect(sidebar.getByText('Sending…')).toHaveCount(0);
		await expect(sidebar.getByRole('link', { name: /is it a stall at ten\?/i })).toHaveAttribute(
			'href',
			'/ask/mock-convo-optimistic'
		);
	});

	test('copy and feedback controls respond', async ({ page, context }) => {
		// Headless Chromium blocks programmatic clipboard access unless the permission is
		// granted explicitly (real browsers auto-allow it on a user gesture like this click).
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await signUpTestUser(page, 'chat-actions');
		await page.route('**/api/ai/chat', (route) =>
			route.fulfill(CHAT_STREAM('mock-convo-2', 'mock-msg-a'))
		);
		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		await page.getByRole('textbox', { name: 'Your message' }).fill('Is it a stall at ten?');
		await page.getByRole('button', { name: /^send$/i }).click();
		await expect(page.getByText(/that is a turnover/).first()).toBeVisible();
		await page.getByRole('button', { name: /^copy$/i }).click();
		await expect(page.getByRole('button', { name: /^copied$/i })).toBeVisible();
		const thumbsUp = page.getByRole('button', { name: 'Good answer' });
		await thumbsUp.click();
		await expect(thumbsUp).toHaveAttribute('aria-pressed', 'true');
	});

	test('daily limit: 429 message shows, typed message is preserved', async ({ page }) => {
		await signUpTestUser(page, 'chat-limit');
		await page.route('**/api/ai/chat', (route) =>
			route.fulfill({
				status: 429,
				contentType: 'application/json',
				body: JSON.stringify({ message: 'Daily question limit reached — try again tomorrow' })
			})
		);
		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		await page.getByRole('textbox', { name: 'Your message' }).fill('Is it a stall at ten?');
		await page.getByRole('button', { name: /^send$/i }).click();
		await expect(page.getByText(/daily question limit reached/i)).toBeVisible();
		await expect(page.getByRole('textbox', { name: 'Your message' })).toHaveValue(
			'Is it a stall at ten?'
		);
	});

	test('Enter sends; Cmd/Ctrl+Enter inserts a newline instead', async ({ page }) => {
		await signUpTestUser(page, 'chat-keys');
		await page.route('**/api/ai/chat', (route) =>
			route.fulfill(CHAT_STREAM('mock-convo-3', 'mock-msg-k'))
		);
		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		const box = page.getByRole('textbox', { name: 'Your message' });
		await box.fill('First line');
		await box.press('ControlOrMeta+Enter');
		await expect(box).toHaveValue('First line\n');
		await box.pressSequentially('second line');
		await box.press('Enter');
		await expect(page.getByText(/that is a turnover/)).toBeVisible();
	});

	test('mid-stream error event keeps the partial answer and shows a retryable error', async ({
		page
	}) => {
		await signUpTestUser(page, 'chat-err');
		await page.route('**/api/ai/chat', (route) =>
			route.fulfill({
				...CHAT_STREAM('mock-convo-err', 'mock-msg-err'),
				body: '{"t":"text","text":"Partial answer per [15.D]. "}\n{"t":"error"}\n'
			})
		);
		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		await page.getByRole('textbox', { name: 'Your message' }).fill('Is it a stall at ten?');
		await page.getByRole('button', { name: /^send$/i }).click();
		await expect(page.getByText(/partial answer per/i)).toBeVisible();
		await expect(page.getByText(/this answer was cut short/i)).toBeVisible();
		await expect(page.getByText(/ran into a problem/i)).toBeVisible();
		await expect(page).toHaveURL(/\/ask\/mock-convo-err$/); // bookkeeping still ran
	});

	test('error event with no answer text shows the something-went-wrong bubble', async ({
		page
	}) => {
		await signUpTestUser(page, 'chat-err-empty');
		await page.route('**/api/ai/chat', (route) =>
			route.fulfill({
				...CHAT_STREAM('mock-convo-err2', 'mock-msg-err2'),
				body: '{"t":"think","text":"**Stuck**"}\n{"t":"error"}\n'
			})
		);
		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		await page.getByRole('textbox', { name: 'Your message' }).fill('Is it a stall at ten?');
		await page.getByRole('button', { name: /^send$/i }).click();
		await expect(page.getByText('Something went wrong')).toBeVisible();
		// The error bubble carries its own Retry affordance, so no composer alert accompanies it.
		await expect(page.getByRole('alert')).toHaveCount(0);
	});

	test('retry regenerates a failed answer in place', async ({ page }) => {
		await signUpTestUser(page, 'chat-retry');
		let calls = 0;
		let secondBody: unknown = null;
		await page.route('**/api/ai/chat', async (route) => {
			calls += 1;
			if (calls === 1) {
				await route.fulfill({
					...CHAT_STREAM('mock-convo-retry', 'mock-msg-retry-1'),
					body: '{"t":"error"}\n'
				});
			} else {
				secondBody = route.request().postDataJSON();
				await route.fulfill(CHAT_STREAM('mock-convo-retry', 'mock-msg-retry-2'));
			}
		});
		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		await page.getByRole('textbox', { name: 'Your message' }).fill('Is it a stall at ten?');
		await page.getByRole('button', { name: /^send$/i }).click();
		await expect(page.getByText('Something went wrong')).toBeVisible();
		const retryButton = page.getByRole('button', { name: 'Retry', exact: true });
		await expect(retryButton).toBeVisible();

		await retryButton.click();
		await expect(page.getByText('Something went wrong')).toHaveCount(0);
		await expect(page.getByText(/that is a turnover/).first()).toBeVisible();
		// Scoped to the transcript: the same question text also appears in the sidebar's
		// conversation entry, which would otherwise make this ambiguous.
		await expect(page.getByLabel('Messages').getByText('Is it a stall at ten?')).toHaveCount(1);
		expect(secondBody).toEqual({ conversationId: 'mock-convo-retry', retry: true });
	});

	test('stop button aborts the stream and settles back to idle', async ({ page }) => {
		await signUpTestUser(page, 'chat-stop');
		await page.route('**/api/ai/chat', async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 3000));
			// The client may have aborted while we slept — fulfilling then throws; ignore it.
			await route.fulfill(CHAT_STREAM('mock-convo-stop', 'mock-msg-stop')).catch(() => {});
		});
		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		await page.getByRole('textbox', { name: 'Your message' }).fill('Is it a stall at ten?');
		await page.getByRole('button', { name: /^send$/i }).click();
		const stopButton = page.getByRole('button', { name: 'Stop', exact: true });
		await expect(stopButton).toBeVisible();
		await stopButton.click();
		await expect(page.getByRole('button', { name: /^send$/i })).toBeVisible();
		await expect(page.getByText('Is it a stall at ten?')).toBeVisible(); // user bubble kept
		await expect(page.getByRole('alert')).toHaveCount(0);
	});

	test('an in-flight answer survives navigating away and back', async ({ page }) => {
		await signUpTestUser(page, 'chat-bg');
		await page.route('**/api/ai/chat', async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 2000));
			await route.fulfill(CHAT_STREAM('mock-convo-bg', 'mock-msg-bg')).catch(() => {});
		});
		await page.route('**/api/ai/conversations/mock-convo-bg', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					id: 'mock-convo-bg',
					title: 'Is it a stall at ten?',
					rulesetId: 'usau-official-2026-27',
					messages: [
						{
							id: 'mock-user-bg',
							role: 'user',
							content: 'Is it a stall at ten?',
							status: null,
							feedback: null,
							createdAt: Date.now()
						}
					]
				})
			})
		);
		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		await page.getByRole('textbox', { name: 'Your message' }).fill('Is it a stall at ten?');
		await page.getByRole('button', { name: /^send$/i }).click();
		// Leave while the request is still pending — SPA navigation keeps the fetch alive.
		await page.getByRole('link', { name: 'Quiz' }).first().click();
		await expect(page).toHaveURL(/\/quiz/);
		// Come back: the conversation is in the sidebar and the finished answer is there.
		await page.getByRole('link', { name: 'Ask' }).first().click();
		const sidebar = page.getByRole('navigation', { name: 'Conversations' });
		// The entry may still be the optimistic "Sending…" placeholder — wait for it to
		// resolve into a real link once headers arrive before clicking it.
		const entry = sidebar.getByRole('link', { name: /is it a stall at ten\?/i });
		await expect(entry).toBeVisible({ timeout: 10_000 });
		await entry.click();
		await expect(page.getByText(/that is a turnover/).first()).toBeVisible();
	});

	test('two conversations can stream concurrently', async ({ page }) => {
		await signUpTestUser(page, 'chat-multi');
		let calls = 0;
		await page.route('**/api/ai/chat', async (route) => {
			calls += 1;
			if (calls === 1) {
				await new Promise((resolve) => setTimeout(resolve, 4000));
				await route.fulfill(CHAT_STREAM('mock-convo-m1', 'mock-msg-m1')).catch(() => {});
			} else {
				await route.fulfill(CHAT_STREAM('mock-convo-m2', 'mock-msg-m2'));
			}
		});
		await page.route('**/api/ai/conversations/mock-convo-m1', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					id: 'mock-convo-m1',
					title: 'First question about stalls',
					rulesetId: 'usau-official-2026-27',
					messages: [
						{
							id: 'mock-user-m1',
							role: 'user',
							content: 'First question about stalls',
							status: null,
							feedback: null,
							createdAt: Date.now()
						}
					]
				})
			})
		);
		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		await page.getByRole('textbox', { name: 'Your message' }).fill('First question about stalls');
		await page.getByRole('button', { name: /^send$/i }).click();
		// Start a second conversation from a fresh blank view while the first is pending.
		await page.getByRole('link', { name: 'Quiz' }).first().click();
		await expect(page).toHaveURL(/\/quiz/);
		await page.getByRole('link', { name: 'Ask' }).first().click();
		await expect(page).toHaveURL(/\/ask$/);
		await page.getByRole('textbox', { name: 'Your message' }).fill('Second question about fouls');
		await page.getByRole('button', { name: /^send$/i }).click();
		await expect(page.getByText(/that is a turnover/).first()).toBeVisible();
		await expect(page).toHaveURL(/\/ask\/mock-convo-m2$/);
		const sidebar = page.getByRole('navigation', { name: 'Conversations' });
		// The entry may still be the optimistic "Sending…" placeholder — wait for it to
		// resolve into a real link once headers arrive before clicking it.
		const firstEntry = sidebar.getByRole('link', { name: /first question about stalls/i });
		await expect(firstEntry).toBeVisible({ timeout: 10_000 });
		await firstEntry.click();
		await expect(page).toHaveURL(/\/ask\/mock-convo-m1$/);
		await expect(page.getByText(/that is a turnover/).first()).toBeVisible();
	});

	test('new chat gives a fresh composer while a send is still pending', async ({ page }) => {
		await signUpTestUser(page, 'chat-newchat-pending');
		let releaseFulfill: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			releaseFulfill = resolve;
		});
		await page.route('**/api/ai/chat', async (route) => {
			await gate;
			await route
				.fulfill(CHAT_STREAM('mock-convo-newchat-pending', 'mock-msg-newchat-pending'))
				.catch(() => {});
		});
		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		await page.getByRole('textbox', { name: 'Your message' }).fill('Where does a pull start from?');
		await page.getByRole('button', { name: /^send$/i }).click();
		// Scoped to the message thread: the same text now also appears in the sidebar's
		// optimistic "Sending…" entry, which would otherwise make this ambiguous.
		const messages = page.getByLabel('Messages');
		await expect(messages.getByText('Where does a pull start from?')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();

		const conversationsNav = page.getByRole('navigation', { name: 'Conversations' });
		await conversationsNav.getByRole('link', { name: 'New chat' }).click();
		await expect(page).toHaveURL(/\/ask$/);
		await expect(
			page.getByLabel('Messages').getByText('Where does a pull start from?')
		).toHaveCount(0);
		await expect(page.getByRole('button', { name: /^send$/i })).toBeVisible();

		// Headers for the background send arrive: sidebar picks it up, but this
		// fresh view — a different viewToken now — must not adopt it.
		releaseFulfill();
		await expect(conversationsNav.getByText(/where does a pull start from\?/i)).toBeVisible({
			timeout: 10_000
		});
		await expect(page.getByRole('button', { name: /^send$/i })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
	});

	test('new chat clears a stopped pre-headers send', async ({ page }) => {
		await signUpTestUser(page, 'chat-newchat-stopped');
		await page.route('**/api/ai/chat', async (route) => {
			await new Promise((resolve) => setTimeout(resolve, 5000));
			// The client aborts well before this fires — fulfilling an aborted route throws; ignore it.
			await route
				.fulfill(CHAT_STREAM('mock-convo-newchat-stopped', 'mock-msg-newchat-stopped'))
				.catch(() => {});
		});
		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		await page.getByRole('textbox', { name: 'Your message' }).fill('Where does a pull start from?');
		await page.getByRole('button', { name: /^send$/i }).click();
		const stopButton = page.getByRole('button', { name: 'Stop', exact: true });
		await expect(stopButton).toBeVisible();
		await stopButton.click();
		await expect(page.getByRole('button', { name: /^send$/i })).toBeVisible();

		await page
			.getByRole('navigation', { name: 'Conversations' })
			.getByRole('link', { name: 'New chat' })
			.click();
		await expect(page.getByText('Where does a pull start from?')).toHaveCount(0);
		await expect(page.getByRole('button', { name: /^send$/i })).toBeVisible();
		await expect(page.getByRole('textbox', { name: 'Your message' })).toHaveValue('');
	});
});

test.describe('conversation history (seeded D1)', () => {
	test('seeded rows: real list scopes and paginates; detail loads; DELETE soft-deletes; feedback writes', async ({
		page
	}) => {
		test.setTimeout(60_000);
		const { email } = await signUpTestUser(page, 'chat-db');
		d1(`DELETE FROM ai_messages WHERE id LIKE 'seedc-%'`);
		d1(`DELETE FROM ai_conversations WHERE id LIKE 'seedc-%'`);
		const userId = (d1Select(`SELECT id FROM user WHERE email = '${email}'`)[0] as { id: string })
			.id;
		d1(
			`INSERT OR IGNORE INTO user (id, name, email, email_verified) VALUES ('seedc-other-user', 'Other', 'seedc-other@example.com', 1)`
		);
		const base = Date.now();
		// 21 visible conversations forces pagination past the 20-row page.
		const convoValues: string[] = [];
		const msgValues: string[] = [];
		for (let i = 1; i <= 21; i++) {
			convoValues.push(
				`('seedc-v${i}', '${userId}', 'usau-official-2026-27', 'Seeded convo ${i}', ${base - i * 1000}, ${base - i * 1000}, NULL)`
			);
			msgValues.push(
				`('seedc-v${i}-u', 'seedc-v${i}', 'user', 'Seeded question ${i}', NULL, NULL, NULL, ${base - i * 1000})`,
				`('seedc-v${i}-a', 'seedc-v${i}', 'assistant', 'Seeded answer ${i} [15.D]', 'complete', 'seed', NULL, ${base - i * 1000 + 1})`
			);
		}
		// Deleted convo NEWEST of this user's rows (falsifiable filter check) + another user's convo.
		convoValues.push(
			`('seedc-del', '${userId}', 'usau-official-2026-27', 'Deleted convo', ${base - 100}, ${base - 100}, ${base})`,
			`('seedc-other', 'seedc-other-user', 'usau-official-2026-27', 'Other users convo', ${base - 200}, ${base - 200}, NULL)`
		);
		msgValues.push(
			`('seedc-other-a', 'seedc-other', 'assistant', 'Foreign answer', 'complete', 'seed', NULL, ${base - 200})`
		);
		d1(
			`INSERT INTO ai_conversations (id, user_id, ruleset_id, title, created_at, updated_at, deleted_at) VALUES ${convoValues.join(', ')}`
		);
		d1(
			`INSERT INTO ai_messages (id, conversation_id, role, content, status, model, feedback, created_at) VALUES ${msgValues.join(', ')}`
		);

		await page.goto('/ask');
		await page.waitForLoadState('networkidle');
		const sidebar = page.getByRole('navigation', { name: 'Conversations' });
		await expect(sidebar.getByText('Seeded convo 1', { exact: true })).toBeVisible();
		await expect(sidebar.getByText('Deleted convo')).toHaveCount(0);
		await expect(sidebar.getByText('Other users convo')).toHaveCount(0);
		await expect(sidebar.getByText('Seeded convo 21', { exact: true })).toHaveCount(0); // beyond page 1
		await sidebar.getByRole('button', { name: 'Load more' }).click();
		await expect(sidebar.getByText('Seeded convo 21', { exact: true })).toBeVisible();
		await expect(sidebar.getByRole('button', { name: 'Load more' })).toHaveCount(0);

		// Detail page loads real messages; feedback writes to the DB.
		await sidebar.getByText('Seeded convo 2', { exact: true }).click();
		await expect(page.getByText('Seeded question 2')).toBeVisible();
		await expect(page.getByText(/Seeded answer 2/)).toBeVisible();
		await page.getByRole('button', { name: 'Good answer' }).click();
		await expect
			.poll(
				() =>
					(
						d1Select(`SELECT feedback FROM ai_messages WHERE id = 'seedc-v2-a'`)[0] as {
							feedback: string | null;
						}
					).feedback
			)
			.toBe('up');

		// Real soft delete persists across reload; row still exists with deleted_at set.
		await sidebar
			.getByRole('button', { name: 'Delete conversation: Seeded convo 2', exact: true })
			.click();
		await expect(page).toHaveURL(/\/ask$/); // deleting the open conversation navigates home
		await page.reload();
		await page.waitForLoadState('networkidle');
		await expect(sidebar.getByText('Seeded convo 2', { exact: true })).toHaveCount(0);
		const del = d1Select(`SELECT deleted_at FROM ai_conversations WHERE id = 'seedc-v2'`)[0] as {
			deleted_at: number | null;
		};
		expect(del.deleted_at).not.toBeNull();

		// Owner scoping negatives: foreign delete and foreign feedback are silent no-ops.
		const delRes = await page.request.delete('/api/ai/conversations/seedc-other');
		expect(delRes.ok()).toBeTruthy();
		expect(
			(
				d1Select(`SELECT deleted_at FROM ai_conversations WHERE id = 'seedc-other'`)[0] as {
					deleted_at: number | null;
				}
			).deleted_at
		).toBeNull();
		const fbRes = await page.request.post('/api/ai/messages/seedc-other-a/feedback', {
			data: { feedback: 'down' }
		});
		expect(fbRes.ok()).toBeTruthy();
		expect(
			(
				d1Select(`SELECT feedback FROM ai_messages WHERE id = 'seedc-other-a'`)[0] as {
					feedback: string | null;
				}
			).feedback
		).toBeNull();

		// Foreign conversation page → not-found state.
		await page.goto('/ask/seedc-other');
		await page.waitForLoadState('networkidle');
		await expect(page.getByText('Conversation not found')).toBeVisible();
	});
});
