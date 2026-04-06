export const GITHUB_MCP_READ_ONLY_DISABLED_TOOLS = [
  'create_or_update_file',
  'push_files',
  'create_repository',
  'create_issue',
  'create_pull_request',
  'fork_repository',
  'create_branch',
  'update_issue',
  'add_issue_comment',
  'create_pull_request_review',
  'merge_pull_request',
  'update_pull_request_branch',
] as const;

export function isGitHubMcpReadOnlyDisabledTool(toolName: string): boolean {
  return GITHUB_MCP_READ_ONLY_DISABLED_TOOLS.includes(
    toolName as (typeof GITHUB_MCP_READ_ONLY_DISABLED_TOOLS)[number],
  );
}
