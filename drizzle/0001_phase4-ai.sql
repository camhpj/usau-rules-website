CREATE TABLE `ai_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`ruleset_id` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`question` text,
	`rejected_reasons` text,
	`requested_difficulty` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_questions_user_created_idx` ON `ai_questions` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ai_usage` (
	`day` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`day`, `user_id`, `kind`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_usage_day_idx` ON `ai_usage` (`day`);