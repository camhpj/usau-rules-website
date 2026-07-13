CREATE TABLE `ai_asks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`ruleset_id` text NOT NULL,
	`model` text NOT NULL,
	`prompt` text NOT NULL,
	`answer` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_asks_user_created_idx` ON `ai_asks` (`user_id`,`created_at`);