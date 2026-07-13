ALTER TABLE `user` ADD `display_name` text;--> statement-breakpoint
CREATE UNIQUE INDEX `user_display_name_lower_idx` ON `user` (lower("display_name"));