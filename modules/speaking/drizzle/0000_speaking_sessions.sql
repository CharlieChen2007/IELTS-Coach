CREATE TABLE `speaking_sessions` (
    `owner_id` text NOT NULL,
    `session_id` text NOT NULL,
    `created_at` integer NOT NULL,
    `submitted_at` integer NOT NULL,
    `mode` text NOT NULL,
    `duration_ms` integer NOT NULL,
    `interrupted` integer NOT NULL,
    `assessment_eligible` integer NOT NULL,
    `turn_count` integer NOT NULL,
    `metadata_json` text NOT NULL,
    `object_key` text NOT NULL,
    `fingerprint` text NOT NULL,
    `ready` integer DEFAULT 0 NOT NULL,
    PRIMARY KEY (`owner_id`, `session_id`)
);
--> statement-breakpoint
CREATE INDEX `speaking_history_by_owner`
    ON `speaking_sessions` (`owner_id`, `ready`, `created_at`, `session_id`);
