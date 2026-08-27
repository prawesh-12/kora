import { getEncoding } from 'js-tiktoken';

const TARGET_TOKENS = 500;
const OVERLAP_TOKENS = 60;

const encoder = getEncoding('cl100k_base');

export function countTokens(text: string): number {
  return encoder.encode(text).length;
}

export interface ParsedDocument {
  frontmatter: Record<string, string>;
  body: string;
}

export function parseMarkdown(source: string): ParsedDocument {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { frontmatter: {}, body: source };

  const frontmatter: Record<string, string> = {};
  for (const line of (match[1] ?? '').split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    frontmatter[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { frontmatter, body: source.slice(match[0].length) };
}

interface Section {
  headingPath: string;
  paragraphs: string[];
}

/**
 * Splits on headings first so a chunk never straddles two topics, and keeps the
 * heading trail so a citation reads as "Returns > Damaged items > Eligibility".
 */
export function splitIntoSections(body: string): Section[] {
  const sections: Section[] = [];
  const trail: string[] = [];
  let current: Section | null = null;

  const flush = () => {
    if (current && current.paragraphs.length > 0) sections.push(current);
    current = null;
  };

  for (const block of body.split(/\r?\n\s*\r?\n/)) {
    const text = block.trim();
    if (!text) continue;

    const heading = text.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flush();
      const depth = (heading[1] ?? '#').length;
      trail.length = depth - 1;
      trail[depth - 1] = (heading[2] ?? '').trim();
      current = { headingPath: trail.filter(Boolean).join(' > '), paragraphs: [] };
      continue;
    }

    if (!current) current = { headingPath: trail.filter(Boolean).join(' > '), paragraphs: [] };
    current.paragraphs.push(text);
  }

  flush();
  return sections;
}

export interface Chunk {
  ordinal: number;
  headingPath: string;
  content: string;
  tokenCount: number;
}

function overlapFrom(text: string): string {
  // Whole sentences only. Splitting "Replacements are available for" from
  // "7 days from delivery" is how an agent confidently invents a number.
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [text];
  const taken: string[] = [];
  let tokens = 0;
  for (let i = sentences.length - 1; i >= 0; i--) {
    const s = sentences[i] ?? '';
    const n = countTokens(s);
    if (tokens + n > OVERLAP_TOKENS && taken.length > 0) break;
    taken.unshift(s);
    tokens += n;
  }
  return taken.join('').trim();
}

export function chunkMarkdown(body: string): Chunk[] {
  const chunks: Chunk[] = [];
  let ordinal = 0;

  for (const section of splitIntoSections(body)) {
    const prefix = section.headingPath ? `${section.headingPath}\n\n` : '';
    let buffer: string[] = [];
    let tokens = countTokens(prefix);

    const emit = () => {
      if (buffer.length === 0) return;
      const content = prefix + buffer.join('\n\n');
      chunks.push({
        ordinal: ordinal++,
        headingPath: section.headingPath,
        content,
        tokenCount: countTokens(content),
      });
    };

    for (const paragraph of section.paragraphs) {
      const n = countTokens(paragraph);
      if (buffer.length > 0 && tokens + n > TARGET_TOKENS) {
        emit();
        const carry = overlapFrom(buffer.join('\n\n'));
        buffer = carry ? [carry] : [];
        tokens = countTokens(prefix) + (carry ? countTokens(carry) : 0);
      }
      buffer.push(paragraph);
      tokens += n;
    }

    emit();
  }

  return chunks;
}
