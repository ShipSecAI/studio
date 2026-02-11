-- Add post_pr_review rule toggle and pr_review_id result linkage
ALTER TABLE github_trigger_rules
ADD COLUMN post_pr_review BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE github_scan_results
ADD COLUMN pr_review_id bigint;
