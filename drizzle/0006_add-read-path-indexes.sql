DROP INDEX `quiz_attempts_user_created_idx`;--> statement-breakpoint
CREATE INDEX `quiz_attempts_ruleset_mode_idx` ON `quiz_attempts` (`ruleset_id`,`mode`,`user_id`,`score`,`best_streak`);--> statement-breakpoint
CREATE INDEX `quiz_attempts_created_idx` ON `quiz_attempts` (`created_at`);--> statement-breakpoint
CREATE INDEX `quiz_attempts_user_created_idx` ON `quiz_attempts` (`user_id`,`ruleset_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_conversations_updated_id_idx` ON `ai_conversations` (`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `ai_messages_created_idx` ON `ai_messages` (`created_at`);--> statement-breakpoint
CREATE INDEX `ai_messages_feedback_idx` ON `ai_messages` (`feedback`);--> statement-breakpoint
CREATE INDEX `question_responses_at_idx` ON `question_responses` (`at`);--> statement-breakpoint
CREATE INDEX `user_created_idx` ON `user` (`created_at`);