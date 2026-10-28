CREATE TABLE `document_reviews` (
	`document_id` text PRIMARY KEY NOT NULL,
	`source_hash` text NOT NULL,
	`revision` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `template_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`document_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`review_revision` integer NOT NULL,
	`source_hash` text NOT NULL,
	`compiled_hash` text NOT NULL,
	`compiled_path` text NOT NULL,
	`schema_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `version_number_unique` ON `template_versions` (`template_id`,`version_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `review_publication_unique` ON `template_versions` (`document_id`,`review_revision`);--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `templates_document_id_unique` ON `templates` (`document_id`);