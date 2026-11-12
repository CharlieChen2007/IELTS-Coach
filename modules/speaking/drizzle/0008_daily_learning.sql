CREATE TABLE `daily_learning` (
    `owner_id` text NOT NULL,
    `module` text NOT NULL,
    `payload_json` text NOT NULL,
    `updated_at` integer NOT NULL,
    PRIMARY KEY (`owner_id`, `module`)
);
--> statement-breakpoint
CREATE INDEX `daily_learning_by_owner`
    ON `daily_learning` (`owner_id`, `updated_at`);
