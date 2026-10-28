CREATE TABLE `analysis_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`source_hash` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`result_json` text,
	`error_json` text,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
