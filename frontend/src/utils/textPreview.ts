export interface PreviewOptions {
  charLimit?: number;
  lineLimit?: number;
}

export interface PreviewResult {
  text: string;
  truncated: boolean;
}

const DEFAULT_CHAR_LIMIT = 240;
const DEFAULT_LINE_LIMIT = 4;

export function createPreview(
  message: string | undefined | null,
  options: PreviewOptions = {},
): PreviewResult {
  if (!message) {
    return { text: '', truncated: false };
  }

  const charLimit = options.charLimit ?? DEFAULT_CHAR_LIMIT;
  const lineLimit = options.lineLimit ?? DEFAULT_LINE_LIMIT;

  const lines = message.split('\n');

  if (lines.length > lineLimit) {
    const text = lines.slice(0, lineLimit).join('\n').trimEnd();
    return { text, truncated: true };
  }

  if (message.length > charLimit) {
    const text = message.slice(0, charLimit).replace(/\s+$/g, '');
    return { text, truncated: true };
  }

  return { text: message, truncated: false };
}
