import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { now } from '../utils/common';

// ---------------------------------------------------------------------------
// Structured PPTX extraction.
//
// Each slide is a `<p:sp>` (shape) inside `<p:spTree>`. A shape whose `<p:ph>`
// has `type="title"` is the slide title; a body placeholder (`<p:ph idx="1">`
// or `type="body"`) holds the bullet paragraphs. Every `<a:p>` is one
// paragraph; `lvl` is its bullet indent level (0 = top level).
//
// We emit one object per slide:
//   { slideNumber, title, body: [{ level, text }], notes?, markdown }
// and the whole deck as:
//   { source, fileName, slideCount, extractedAt, slides }
// ---------------------------------------------------------------------------

export interface SlideBlock {
  level: number;
  text: string;
}

export interface ExtractedSlide {
  slideNumber: number;
  title: string | null;
  body: SlideBlock[];
  notes: string | null;
  markdown: string;
}

export interface ExtractedPresentation {
  source: 'pptx';
  fileName: string;
  slideCount: number;
  extractedAt: string;
  slides: ExtractedSlide[];
}

type AnyRecord = Record<string, unknown>;

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // p:txBody contains mixed content we must not lose or reformat.
  preserveOrder: false,
  isArray: (name) =>
    name === 'a:p' || name === 'p:sp' || name === 'p:ph' || name === 'a:r',
});

function attr(node: AnyRecord | undefined | null, key: string): string | null {
  const v = node?.[`@_${key}`];
  if (v == null) return null;
  return String(v);
}

function parseTextRuns(p: AnyRecord): string {
  const runs = asArray(p['a:r']);
  return runs
    .map((r) => {
      const t = (r as AnyRecord)['a:t'];
      return typeof t === 'string' ? t : '';
    })
    .join('');
}

function parseParagraph(p: AnyRecord): SlideBlock {
  const levelRaw = attr(p, 'lvl');
  const level = levelRaw == null || levelRaw === '' ? 0 : Number(levelRaw);
  return { level: Number.isFinite(level) ? level : 0, text: parseTextRuns(p).trim() };
}

// Placeholder types that represent the slide title (regular title + the
// centered "title slide" layout used by templates like this one).
const TITLE_PH_TYPES = new Set(['title', 'ctrTitle']);

function shapePlaceholder(sp: AnyRecord): AnyRecord | null {
  const nvSpPr = sp['p:nvSpPr'] as AnyRecord | undefined;
  const nvPr = nvSpPr?.['p:nvPr'] as AnyRecord | undefined;
  const phRaw = nvPr?.['p:ph'];
  // fast-xml-parser may emit a single object or an array here (we force
  // p:ph to an array via isArray); unwrap the first element either way.
  const ph = Array.isArray(phRaw) ? (phRaw[0] as AnyRecord | undefined) : (phRaw as AnyRecord | undefined);
  return ph ?? null;
}

function findTitleShape(spTree: AnyRecord): string | null {
  const sps = asArray(spTree['p:sp']);
  for (const sp of sps) {
    const ph = shapePlaceholder(sp as AnyRecord);
    if (TITLE_PH_TYPES.has(attr(ph, 'type') ?? '')) {
      const text = parseParagraphs(sp as AnyRecord).map((b) => b.text).join(' ').trim();
      if (text) return text;
    }
  }
  return null;
}

function parseParagraphs(sp: AnyRecord): SlideBlock[] {
  const txBody = sp['p:txBody'] as AnyRecord | undefined;
  if (!txBody) return [];
  const ps = asArray(txBody['a:p']);
  return ps
    .map((p) => parseParagraph(p as AnyRecord))
    .filter((b) => b.text.length > 0);
}

function escapeMd(s: string): string {
  return s.replace(/([\\`*_[\]{}()#+.!|>-])/g, '\\$1');
}

function bulletChar(level: number): string {
  return level % 2 === 0 ? '-' : '*';
}

function blockToMd(block: SlideBlock): string {
  return `${'  '.repeat(block.level)}${bulletChar(block.level)} ${escapeMd(block.text)}`;
}

function slideToMarkdown(slide: ExtractedSlide): string {
  const lines: string[] = [];
  if (slide.title) lines.push(`# ${escapeMd(slide.title)}`);
  lines.push(...slide.body.map(blockToMd));
  if (slide.notes) lines.push('', `> ${escapeMd(slide.notes)}`, '');
  return lines.join('\n').trim();
}

// Extract the speaker notes for a slide (ppt/notesSlides/notesSlideN.xml).
async function extractNotes(zip: JSZip, slideNumber: number): Promise<string | null> {
  const file = zip.file(`ppt/notesSlides/notesSlide${slideNumber}.xml`);
  if (!file) return null;
  const xml = await file.async('string');
  const doc = parser.parse(xml) as AnyRecord;
  const notesRoot = doc['p:notes'] as AnyRecord | undefined;
  const cSld = notesRoot?.['p:cSld'] as AnyRecord | undefined;
  const spTree = cSld?.['p:spTree'] as AnyRecord | undefined;
  const sps = asArray(spTree?.['p:sp']);
  const blocks: SlideBlock[] = [];
  for (const sp of sps) {
    const ph = shapePlaceholder(sp as AnyRecord);
    const type = attr(ph, 'type');
    if (type === 'body' || type == null) {
      blocks.push(...parseParagraphs(sp as AnyRecord));
    }
  }
  const text = blocks.map((b) => b.text).join(' ').trim();
  return text.length > 0 ? text : null;
}

export async function extractPptxSlides(file: File): Promise<ExtractedPresentation> {
  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);

  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)/i)?.[1] ?? 0);
      const nb = Number(b.match(/slide(\d+)/i)?.[1] ?? 0);
      return na - nb;
    });

  const slides: ExtractedSlide[] = [];
  for (const name of slideFiles) {
    const slideNumber = slides.length + 1;
    const xml = await zip.file(name)!.async('string');
    const doc = parser.parse(xml) as AnyRecord;
    const sld = doc['p:sld'] as AnyRecord | undefined;
    const cSld = sld?.['p:cSld'] as AnyRecord | undefined;
    const spTree = (cSld?.['p:spTree'] as AnyRecord | undefined) ?? {};

    const title = findTitleShape(spTree);
    const body = asArray(spTree['p:sp'])
      .filter((sp) => {
        const ph = shapePlaceholder(sp as AnyRecord);
        const type = attr(ph, 'type');
        // Body placeholder: type="body" / "subTitle", or an untitled idx
        // placeholder (the common "Content Placeholder" from PowerPoint
        // templates).
        return type === 'body' || type === 'subTitle' || (type == null && attr(ph, 'idx') != null);
      })
      .flatMap((sp) => parseParagraphs(sp as AnyRecord));

    const notes = await extractNotes(zip, slideNumber);
    const slide: ExtractedSlide = { slideNumber, title, body, notes, markdown: '' };
    slide.markdown = slideToMarkdown(slide);
    slides.push(slide);
  }

  return {
    source: 'pptx',
    fileName: file.name,
    slideCount: slides.length,
    extractedAt: now(),
    slides,
  };
}

// Render the whole deck as a single Markdown document (one ## per slide).
export function deckToMarkdown(extracted: ExtractedPresentation): string {
  const parts: string[] = [];
  for (const slide of extracted.slides) {
    const lines: string[] = [`## Slide ${slide.slideNumber}`];
    if (slide.title) lines.push(`**${escapeMd(slide.title)}**`);
    lines.push(...slide.body.map(blockToMd));
    if (slide.notes) lines.push('', `> ${escapeMd(slide.notes)}`);
    parts.push(lines.join('\n'));
  }
  return parts.join('\n\n---\n\n');
}
