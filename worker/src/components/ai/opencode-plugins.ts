/**
 * OpenCode plugin activation via `npx oh-my-opencode install` CLI.
 *
 * When enablePlugins is set, the wrapper script installs and activates
 * real plugins before running the agent task.
 *
 * Requirements:
 * - `npm` and `git` must be available in the Docker image
 * - Network access for npm install (~15s overhead)
 */

/**
 * Generate shell script lines to install and activate OpenCode plugins.
 */
export function getOpenCodePluginSetupScript(enablePlugins: string[]): string[] {
  if (!enablePlugins || enablePlugins.length === 0) return [];

  const lines: string[] = [
    '',
    '# --- Plugin Installation ---',
    'echo "[ShipSec] Installing OpenCode plugins..." >&2',
  ];

  for (const plugin of enablePlugins) {
    switch (plugin) {
      case 'oh-my-opencode':
        lines.push('npx oh-my-opencode install --no-tui --openai=yes 2>&1 | tail -3 >&2 || true');
        break;
      default:
        lines.push(`echo "[ShipSec] Unknown plugin: ${plugin}" >&2`);
    }
  }

  lines.push('echo "[ShipSec] Plugin setup complete." >&2');
  lines.push('');

  return lines;
}
