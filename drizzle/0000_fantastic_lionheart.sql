CREATE TABLE `shipment_archive_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_successful_at` text NOT NULL,
	`source_updated_at` text,
	`source_first_date` text NOT NULL,
	`source_last_date` text NOT NULL,
	`source_entry_count` integer NOT NULL,
	CONSTRAINT "shipment_archive_state_singleton_check" CHECK("shipment_archive_state"."id" = 1),
	CONSTRAINT "shipment_archive_state_entry_count_check" CHECK("shipment_archive_state"."source_entry_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE `shipment_entries` (
	`shipment_date` text NOT NULL,
	`color` text NOT NULL,
	`model` text NOT NULL,
	`source_variant` text NOT NULL,
	`start_prefix` integer NOT NULL,
	`end_prefix` integer NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	PRIMARY KEY(`shipment_date`, `color`, `model`, `start_prefix`, `end_prefix`),
	CONSTRAINT "shipment_entries_color_check" CHECK("shipment_entries"."color" in ('Black', 'White', 'Rainbow', 'Clear Purple')),
	CONSTRAINT "shipment_entries_model_check" CHECK("shipment_entries"."model" in ('lite', 'base', 'pro', 'max-512', 'max-1tb')),
	CONSTRAINT "shipment_entries_prefix_check" CHECK("shipment_entries"."start_prefix" between 1000 and 9999 and "shipment_entries"."end_prefix" between "shipment_entries"."start_prefix" and 9999)
);
--> statement-breakpoint
CREATE INDEX `idx_shipment_entries_date_seen` ON `shipment_entries` (`shipment_date`,`last_seen_at`);