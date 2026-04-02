export interface SlackMessagePayload {
  text: string;
  blocks?: Record<string, unknown>[];
}

const SLACK_SECTION_TEXT_LIMIT = 2800;
const CONTINUATION_PREFIX_TEMPLATE = '_continued {current}/{total}_\n';

function convertMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<$2|$1>');
}

function convertEmphasis(text: string): string {
  return text.replace(/\*\*([^*\n]+)\*\*/g, '*$1*').replace(/~~([^~\n]+)~~/g, '~$1~');
}

function normalizeHeading(line: string): string {
  const match = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
  if (!match) return line;
  return `*${match[1].trim()}*`;
}

function normalizeListMarker(line: string): string {
  return line.replace(/^(\s*)[-+*]\s+/, '$1• ');
}

function convertMarkdownTables(text: string): string {
  const lines = text.split('\n');
  const output: string[] = [];
  let i = 0;

  const isTableSeparator = (line: string) =>
    /^\s*\|?[\s:-]+(?:\|[\s:-]+)+\|?\s*$/.test(line) ||
    /^\s*:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)+\s*$/.test(line);

  while (i < lines.length) {
    const current = lines[i];
    const next = lines[i + 1];

    if (current?.includes('|') && next && isTableSeparator(next)) {
      const tableLines = [current, next];
      i += 2;
      while (i < lines.length && lines[i].includes('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      output.push('```');
      output.push(...tableLines);
      output.push('```');
      continue;
    }

    output.push(current);
    i++;
  }

  return output.join('\n');
}

export function markdownToSlackMrkdwn(markdown: string): string {
  const normalized = convertMarkdownTables(markdown.replace(/\r\n?/g, '\n'));
  const lines = normalized.split('\n');
  const output: string[] = [];
  let inCodeFence = false;

  for (const rawLine of lines) {
    const fenceMatch = rawLine.match(/^\s*```.*$/);
    if (fenceMatch) {
      inCodeFence = !inCodeFence;
      output.push('```');
      continue;
    }

    if (inCodeFence) {
      output.push(rawLine);
      continue;
    }

    let line = rawLine;
    line = normalizeHeading(line);
    line = normalizeListMarker(line);
    line = convertMarkdownLinks(line);
    line = convertEmphasis(line);

    output.push(line);
  }

  return output.join('\n').trim();
}

function splitIntoBlocks(text: string): string[] {
  const lines = text.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  let inCodeFence = false;

  const flush = () => {
    if (current.length === 0) return;
    blocks.push(current.join('\n').trimEnd());
    current = [];
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (!inCodeFence && current.length > 0) {
        flush();
      }
      current.push(line);
      inCodeFence = !inCodeFence;
      if (!inCodeFence) {
        flush();
      }
      continue;
    }

    if (inCodeFence) {
      current.push(line);
      continue;
    }

    if (line.trim() === '') {
      flush();
      continue;
    }

    current.push(line);
  }

  flush();
  return blocks.filter(Boolean);
}

function splitParagraph(block: string, maxLength: number): string[] {
  if (block.length <= maxLength) return [block];

  const sentenceParts = block.match(/[^.!?\n]+[.!?]?/g) ?? [block];
  const chunks: string[] = [];
  let current = '';

  const pushCurrent = () => {
    if (!current) return;
    chunks.push(current.trim());
    current = '';
  };

  for (const sentence of sentenceParts) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    const candidate = current ? `${current} ${trimmed}` : trimmed;
    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }
    pushCurrent();
    if (trimmed.length <= maxLength) {
      current = trimmed;
      continue;
    }
    let remainder = trimmed;
    while (remainder.length > maxLength) {
      const splitAt = remainder.lastIndexOf(' ', maxLength);
      const boundary = splitAt > Math.floor(maxLength / 2) ? splitAt : maxLength;
      chunks.push(remainder.slice(0, boundary).trim());
      remainder = remainder.slice(boundary).trim();
    }
    current = remainder;
  }

  pushCurrent();
  return chunks.filter(Boolean);
}

function splitCodeFence(block: string, maxLength: number): string[] {
  if (block.length <= maxLength) return [block];

  const lines = block.split('\n');
  const firstLine = lines[0] ?? '```';
  const lastLine = lines.at(-1) === '```' ? '```' : '';
  const bodyLines = lastLine ? lines.slice(1, -1) : lines.slice(1);
  const chunks: string[] = [];
  let currentLines: string[] = [];

  const wrap = (body: string[]) => [firstLine, ...body, '```'].join('\n');

  for (const line of bodyLines) {
    const candidate = wrap([...currentLines, line]);
    if (candidate.length <= maxLength) {
      currentLines.push(line);
      continue;
    }

    if (currentLines.length > 0) {
      chunks.push(wrap(currentLines));
      currentLines = [];
    }

    if (wrap([line]).length <= maxLength) {
      currentLines.push(line);
      continue;
    }

    let remainder = line;
    while (remainder.length > 0) {
      const overhead = firstLine.length + lastLine.length + 2;
      const allowed = Math.max(32, maxLength - overhead);
      const piece = remainder.slice(0, allowed);
      chunks.push(wrap([piece]));
      remainder = remainder.slice(allowed);
    }
  }

  if (currentLines.length > 0) {
    chunks.push(wrap(currentLines));
  }

  return chunks;
}

function splitOversizedBlock(block: string, maxLength: number): string[] {
  if (/^\s*```/.test(block)) {
    return splitCodeFence(block, maxLength);
  }
  return splitParagraph(block, maxLength);
}

export function chunkSlackMrkdwn(text: string, maxLength = SLACK_SECTION_TEXT_LIMIT): string[] {
  const blocks = splitIntoBlocks(text);
  const chunks: string[] = [];
  let current = '';

  const pushCurrent = () => {
    if (!current) return;
    chunks.push(current);
    current = '';
  };

  for (const block of blocks) {
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }

    pushCurrent();

    if (block.length <= maxLength) {
      current = block;
      continue;
    }

    for (const part of splitOversizedBlock(block, maxLength)) {
      if (part.length <= maxLength) {
        chunks.push(part);
        continue;
      }
      chunks.push(part.slice(0, maxLength));
    }
  }

  pushCurrent();

  if (chunks.length <= 1) {
    return chunks;
  }

  return chunks.map((chunk, index) => {
    if (index === 0) return chunk;
    const prefix = CONTINUATION_PREFIX_TEMPLATE.replace('{current}', String(index + 1)).replace(
      '{total}',
      String(chunks.length),
    );
    const allowedLength = maxLength - prefix.length;
    const body = chunk.length <= allowedLength ? chunk : chunk.slice(0, allowedLength);
    return `${prefix}${body}`;
  });
}

export function renderSlackMessagePayloads(markdown: string): SlackMessagePayload[] {
  const mrkdwn = markdownToSlackMrkdwn(markdown);
  const chunks = chunkSlackMrkdwn(mrkdwn);

  return chunks.map((chunk) => ({
    text: chunk,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: chunk,
        },
      },
    ],
  }));
}
