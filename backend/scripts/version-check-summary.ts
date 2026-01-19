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
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgRed: '\x1b[41m',
};

// Emoji regex to match common emojis (they take 2 columns in terminal)
const emojiRegex = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu;

function getDisplayWidth(str: string): number {
  // Remove ANSI codes first
  // eslint-disable-next-line no-control-regex
  const plain = str.replace(/\x1b\[[0-9;]*m/g, '');
  // Count emojis (each takes 2 columns but counts as 1-2 chars)
  const emojis = plain.match(emojiRegex) || [];
  // Base length minus emoji chars, plus 2 per emoji for display width
  const baseLen = [...plain].length;
  return baseLen + emojis.length; // Add 1 extra column per emoji
}

function printBox(lines: string[], borderColor: string) {
  const maxLen = Math.max(...lines.map((l) => getDisplayWidth(l)));
  const width = maxLen + 4;
  const border = '─'.repeat(width - 2);

  console.log(`${borderColor}┌${border}┐${colors.reset}`);
  for (const line of lines) {
    const displayLen = getDisplayWidth(line);
    const padding = ' '.repeat(maxLen - displayLen);
    console.log(`${borderColor}│${colors.reset} ${line}${padding} ${borderColor}│${colors.reset}`);
  }
  console.log(`${borderColor}└${border}┘${colors.reset}`);
}

async function main() {
  if (isVersionCheckDisabled(process.env)) {
    printBox([`${colors.dim}Version check skipped (disabled via env)${colors.reset}`], colors.dim);
    return;
  }

  try {
    const result = await performVersionCheck();
    const currentVersion = result.requestedVersion;
    const latest = result.response.latest_version;
    const minSupported = result.response.min_supported_version;

    if (result.outcome === 'unsupported') {
      const lines = [
        `${colors.red}${colors.bold}❌ UNSUPPORTED VERSION${colors.reset}`,
        '',
        `${colors.white}Current version:${colors.reset}  ${colors.red}${colors.bold}v${currentVersion}${colors.reset}`,
        `${colors.white}Latest version:${colors.reset}   ${colors.green}v${latest}${colors.reset}`,
        `${colors.white}Min supported:${colors.reset}    ${colors.yellow}v${minSupported}${colors.reset}`,
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
      printBox(lines, colors.red);
      return;
    }

    if (result.outcome === 'upgrade') {
      const lines = [
        `${colors.yellow}${colors.bold}⚠️  UPDATE AVAILABLE${colors.reset}`,
        '',
        `${colors.white}Current version:${colors.reset}  ${colors.yellow}v${currentVersion}${colors.reset}`,
        `${colors.white}Latest version:${colors.reset}   ${colors.green}${colors.bold}v${latest}${colors.reset}`,
        '',
        `${colors.yellow}A newer version is available.${colors.reset}`,
      ];
      if (result.response.upgrade_url) {
        lines.push('');
        lines.push(
          `${colors.cyan}${colors.bold}Upgrade:${colors.reset} ${result.response.upgrade_url}`,
        );
      }
      printBox(lines, colors.yellow);
      return;
    }

    // outcome === 'ok'
    const lines = [
      `${colors.green}${colors.bold}✅ UP TO DATE${colors.reset}`,
      '',
      `${colors.white}Version:${colors.reset} ${colors.green}${colors.bold}v${currentVersion}${colors.reset}`,
      '',
      `${colors.green}You are running the latest version.${colors.reset}`,
    ];
    printBox(lines, colors.green);
  } catch (error) {
    const lines = [
      `${colors.dim}${colors.bold}⚠️  VERSION CHECK SKIPPED${colors.reset}`,
      '',
      `${colors.dim}Unable to contact version service.${colors.reset}`,
      `${colors.dim}${error instanceof Error ? error.message : String(error)}${colors.reset}`,
    ];
    printBox(lines, colors.dim);
  }
}

main().catch((error) => {
  console.error(`${colors.red}[version-check] Unexpected error:${colors.reset}`, error);
  process.exitCode = 1;
});
