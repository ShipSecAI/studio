import { isVersionCheckDisabled, performVersionCheck } from '../src/version-check';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

// Extra spaces after emojis to ensure visible gap across terminal fonts.
const labels = {
  ok: `${colors.green}${colors.bold}✅   UP TO DATE${colors.reset}`,
  upgrade: `${colors.yellow}${colors.bold}⚠️    UPDATE AVAILABLE${colors.reset}`,
  unsupported: `${colors.red}${colors.bold}❌   UNSUPPORTED VERSION${colors.reset}`,
  skipped: `${colors.dim}${colors.bold}⚠️    VERSION CHECK SKIPPED${colors.reset}`,
};

function printSection(lines: string[], accentColor: string) {
  const separator = `${accentColor}${'='.repeat(48)}${colors.reset}`;
  console.log(separator);
  for (const line of lines) {
    if (line === '') {
      console.log('');
    } else {
      console.log(`  ${line}`);
    }
  }
  console.log(separator);
}

async function main() {
  if (isVersionCheckDisabled(process.env)) {
    printSection(
      [`${colors.dim}Version check skipped (disabled via env)${colors.reset}`],
      colors.dim,
    );
    return;
  }

  try {
    const result = await performVersionCheck();
    const currentVersion = result.requestedVersion;
    const latest = result.response.latest_version;
    const minSupported = result.response.min_supported_version;

    if (result.outcome === 'unsupported') {
      const lines = [
        labels.unsupported,
        '',
        `${colors.cyan}Current version:${colors.reset}  ${colors.red}${colors.bold}v${currentVersion}${colors.reset}`,
        `${colors.cyan}Latest version:${colors.reset}   ${colors.green}v${latest}${colors.reset}`,
        `${colors.cyan}Min supported:${colors.reset}    ${colors.yellow}v${minSupported}${colors.reset}`,
        '',
        `${colors.red}Your version is no longer supported.${colors.reset}`,
        `${colors.red}Please upgrade to continue receiving updates.${colors.reset}`,
      ];
      if (result.response.upgrade_url) {
        lines.push('');
        lines.push(
          `${colors.cyan}${colors.bold}Upgrade:${colors.reset} ${result.response.upgrade_url}`,
        );
      }
      printSection(lines, colors.red);
      return;
    }

    if (result.outcome === 'upgrade') {
      const lines = [
        labels.upgrade,
        '',
        `${colors.cyan}Current version:${colors.reset}  ${colors.yellow}v${currentVersion}${colors.reset}`,
        `${colors.cyan}Latest version:${colors.reset}   ${colors.green}${colors.bold}v${latest}${colors.reset}`,
        '',
        `${colors.yellow}A newer version is available.${colors.reset}`,
      ];
      if (result.response.upgrade_url) {
        lines.push('');
        lines.push(
          `${colors.cyan}${colors.bold}Upgrade:${colors.reset} ${result.response.upgrade_url}`,
        );
      }
      printSection(lines, colors.yellow);
      return;
    }

    // outcome === 'ok'
    const lines = [
      labels.ok,
      '',
      `${colors.green}Version:${colors.reset} ${colors.green}${colors.bold}v${currentVersion}${colors.reset}`,
      '',
      `${colors.green}You are running the latest version.${colors.reset}`,
    ];
    printSection(lines, colors.green);
  } catch (error) {
    const lines = [
      labels.skipped,
      '',
      `${colors.dim}Unable to contact version service.${colors.reset}`,
      `${colors.dim}${error instanceof Error ? error.message : String(error)}${colors.reset}`,
    ];
    printSection(lines, colors.dim);
  }
}

main().catch((error) => {
  console.error(`${colors.red}[version-check] Unexpected error:${colors.reset}`, error);
  process.exitCode = 1;
});
