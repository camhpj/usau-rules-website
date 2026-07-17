CREATE TABLE `ai_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`ruleset_id` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_conversations_user_updated_idx` ON `ai_conversations` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `ai_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`status` text,
	`model` text,
	`feedback` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_messages_convo_created_idx` ON `ai_messages` (`conversation_id`,`created_at`);--> statement-breakpoint
INSERT INTO `ai_conversations` (`id`, `user_id`, `ruleset_id`, `title`, `created_at`, `updated_at`, `deleted_at`)
SELECT 'conv-' || `id`, `user_id`, `ruleset_id`, substr(`prompt`, 1, 80), `created_at`, `created_at`, `hidden_at`
FROM `ai_asks` WHERE `status` != 'error';
--> statement-breakpoint
INSERT INTO `ai_messages` (`id`, `conversation_id`, `role`, `content`, `status`, `model`, `feedback`, `created_at`)
SELECT 'msgu-' || `id`, 'conv-' || `id`, 'user', `prompt`, NULL, NULL, NULL, `created_at`
FROM `ai_asks` WHERE `status` != 'error';
--> statement-breakpoint
INSERT INTO `ai_messages` (`id`, `conversation_id`, `role`, `content`, `status`, `model`, `feedback`, `created_at`)
SELECT 'msga-' || `id`, 'conv-' || `id`, 'assistant', coalesce(`answer`, ''),
       CASE `status` WHEN 'answered' THEN 'complete' ELSE 'truncated' END, `model`, NULL, `created_at` + 1
FROM `ai_asks` WHERE `status` != 'error';
--> statement-breakpoint
DROP TABLE `ai_asks`;