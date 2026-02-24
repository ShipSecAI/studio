-- Widen check_run_id and pr_comment_id to bigint
-- GitHub IDs can exceed INT4 max (2,147,483,647)
ALTER TABLE "github_scan_results" ALTER COLUMN "check_run_id" SET DATA TYPE bigint;
ALTER TABLE "github_scan_results" ALTER COLUMN "pr_comment_id" SET DATA TYPE bigint;
