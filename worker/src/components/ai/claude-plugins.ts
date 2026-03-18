/**
 * Claude Code plugin activation via native `claude plugins` CLI.
 *
 * When enablePlugins is set, the wrapper script installs and activates
 * real plugins before running the agent task. This gives the agent access
 * to the full plugin framework: skills, agents, hooks, and MCP servers.
 *
 * Requirements:
 * - `git` must be available in the Docker image
 * - Network access for marketplace + plugin git clones (~10s overhead)
 */

export const PLUGIN_MARKETPLACE_URLS: Record<string, string> = {
  superpowers: 'https://github.com/anthropics/claude-plugins-official',
  'oh-my-claudecode': 'https://github.com/Yeachan-Heo/oh-my-claudecode',
};

/**
 * Generate shell script lines to install and activate plugins before running claude.
 * Uses the native `claude plugins marketplace add` + `claude plugins install` + `claude plugins enable` CLI.
 */
export function getPluginSetupScript(enablePlugins: string[]): string[] {
  if (!enablePlugins || enablePlugins.length === 0) return [];

  const lines: string[] = [
    '',
    '# --- Plugin Installation ---',
    'echo "[ShipSec] Installing Claude Code plugins..." >&2',
  ];

  // Collect unique marketplace URLs
  const marketplaces = new Set<string>();
  for (const plugin of enablePlugins) {
    const url = PLUGIN_MARKETPLACE_URLS[plugin];
    if (url) marketplaces.add(url);
  }

  // Add marketplaces
  for (const url of marketplaces) {
    lines.push(`claude plugins marketplace add ${url} 2>&1 | tail -1 >&2 || true`);
  }

  // Install and enable each plugin
  for (const plugin of enablePlugins) {
    lines.push(`claude plugins install ${plugin} 2>&1 | tail -1 >&2 || true`);
    lines.push(`claude plugins enable ${plugin} 2>&1 | tail -1 >&2 || true`);
  }

  lines.push('echo "[ShipSec] Plugin setup complete." >&2');
  lines.push('');

  return lines;
}
