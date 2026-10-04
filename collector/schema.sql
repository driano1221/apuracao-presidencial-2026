CREATE TABLE `collector` (
	`key` text PRIMARY KEY NOT NULL,
	`context` text,
	`config_at` integer DEFAULT 0 NOT NULL,
	`etag` text,
	`modified` text,
	`checked_at` integer DEFAULT 0 NOT NULL,
	`next_check` integer DEFAULT 0 NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`error` text,
	`current` text
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`observed_at` integer NOT NULL,
	`generated_at` integer NOT NULL,
	`series` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `snapshots_key_observed` ON `snapshots` (`key`,`observed_at`);