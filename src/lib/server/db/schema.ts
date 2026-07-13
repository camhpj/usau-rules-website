import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// ---- better-auth core tables (shape per better-auth CLI drizzle/sqlite output) ----

export const user = sqliteTable('user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: integer('email_verified', { mode: 'boolean' }).default(false).notNull(),
	image: text('image'),
	createdAt: integer('created_at', { mode: 'timestamp_ms' })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.$onUpdate(() => new Date())
		.notNull()
});

export const session = sqliteTable(
	'session',
	{
		id: text('id').primaryKey(),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		token: text('token').notNull().unique(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.$onUpdate(() => new Date())
			.notNull(),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' })
	},
	(table) => [index('session_userId_idx').on(table.userId)]
);

export const account = sqliteTable(
	'account',
	{
		id: text('id').primaryKey(),
		accountId: text('account_id').notNull(),
		providerId: text('provider_id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		accessToken: text('access_token'),
		refreshToken: text('refresh_token'),
		idToken: text('id_token'),
		accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
		refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
		scope: text('scope'),
		password: text('password'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.$onUpdate(() => new Date())
			.notNull()
	},
	(table) => [index('account_userId_idx').on(table.userId)]
);

export const verification = sqliteTable(
	'verification',
	{
		id: text('id').primaryKey(),
		identifier: text('identifier').notNull(),
		value: text('value').notNull(),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.$onUpdate(() => new Date())
			.notNull()
	},
	(table) => [index('verification_identifier_idx').on(table.identifier)]
);

// ---- app tables (spec: quiz_attempts, question_responses, bookmarks) ----
// Epoch-ms integers (plain, not timestamp mode) to match the client's ResponseRecord.at.

export const quizAttempts = sqliteTable(
	'quiz_attempts',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		clientId: text('client_id').notNull().unique(), // idempotency key (uuid or "timed:<runId>")
		rulesetId: text('ruleset_id').notNull(),
		mode: text('mode', { enum: ['quick', 'mastery', 'timed'] }).notNull(),
		sectionSlug: text('section_slug'),
		score: integer('score').notNull(), // server-recomputed, never client-supplied
		total: integer('total').notNull(),
		bestStreak: integer('best_streak'), // timed mode only, server-recomputed
		startedAt: integer('started_at').notNull(),
		durationS: integer('duration_s').notNull(),
		createdAt: integer('created_at').notNull()
	},
	(table) => [index('quiz_attempts_user_created_idx').on(table.userId, table.createdAt)]
);

export const questionResponses = sqliteTable(
	'question_responses',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		attemptId: text('attempt_id')
			.notNull()
			.references(() => quizAttempts.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		rulesetId: text('ruleset_id').notNull(),
		questionId: text('question_id').notNull(),
		sectionSlug: text('section_slug').notNull(), // from the bank, never client-supplied
		choiceIndex: integer('choice_index').notNull(), // index into question.choices (original order)
		correct: integer('correct', { mode: 'boolean' }).notNull(), // server-recomputed
		at: integer('at').notNull()
	},
	(table) => [
		index('question_responses_user_ruleset_at_idx').on(table.userId, table.rulesetId, table.at)
	]
);

export const bookmarks = sqliteTable(
	'bookmarks',
	{
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		rulesetId: text('ruleset_id').notNull(),
		ruleId: text('rule_id').notNull(),
		createdAt: integer('created_at').notNull()
	},
	(table) => [primaryKey({ columns: [table.userId, table.rulesetId, table.ruleId] })]
);

// ---- Phase 4: AI (spec: ai_questions log + usage counters; cache registry is an implementation table) ----

export const aiQuestions = sqliteTable(
	'ai_questions',
	{
		id: text('id').primaryKey(), // uuid; a served AI question's public id is `ai-${id}`
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		rulesetId: text('ruleset_id').notNull(),
		model: text('model').notNull(),
		// served = validated AI question returned; fallback = bank question returned after retries
		status: text('status', { enum: ['served', 'fallback'] }).notNull(),
		question: text('question'), // JSON of the served Question; NULL on fallback
		rejectedReasons: text('rejected_reasons'), // draft rejections along the way (curation signal)
		requestedDifficulty: integer('requested_difficulty'),
		createdAt: integer('created_at').notNull()
	},
	(table) => [index('ai_questions_user_created_idx').on(table.userId, table.createdAt)]
);

export const aiUsage = sqliteTable(
	'ai_usage',
	{
		day: text('day').notNull(), // UTC YYYY-MM-DD
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: ['ask', 'scenario'] }).notNull(),
		count: integer('count').notNull().default(0)
	},
	(table) => [
		primaryKey({ columns: [table.day, table.userId, table.kind] }),
		index('ai_usage_day_idx').on(table.day)
	]
);

export const aiAsks = sqliteTable(
	'ai_asks',
	{
		id: text('id').primaryKey(), // uuid
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		rulesetId: text('ruleset_id').notNull(),
		model: text('model').notNull(),
		prompt: text('prompt').notNull(), // the user's question (Zod-capped at 500 chars upstream)
		answer: text('answer'), // final streamed answer; NULL when status = 'error'
		// answered = stream completed; truncated = MAX_TOKENS cut it short; error = no stream (502 path)
		status: text('status', { enum: ['answered', 'truncated', 'error'] }).notNull(),
		createdAt: integer('created_at').notNull()
	},
	(table) => [index('ai_asks_user_created_idx').on(table.userId, table.createdAt)]
);

export const aiCache = sqliteTable('ai_cache', {
	key: text('key').primaryKey(), // `${model}|${rulesetId}`
	name: text('name').notNull(), // Gemini cachedContents/<id> resource name
	expiresAt: integer('expires_at').notNull()
});
