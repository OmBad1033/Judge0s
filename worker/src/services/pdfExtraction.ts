import { extractText, getDocumentProxy } from 'unpdf';
import { now } from '../utils/common';

export interface ExtractedSlide {
  pageNumber: number;
  text: string;
}

export interface ExtractedPresentation {
  source: 'pdf';
  fileName: string;
  slideCount: number;
  extractedAt: string;
  slides: ExtractedSlide[];
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export async function extractPdfSlides(buffer: ArrayBuffer, fileName: string): Promise<ExtractedPresentation> {
  const result = await extractText(buffer, { mergePages: false });
  const pages = (result.text ?? []).map(clean);
  const totalPages = result.totalPages ?? pages.length;

  return {
    source: 'pdf',
    fileName,
    slideCount: totalPages,
    extractedAt: now(),
    slides: pages.map((text, i) => ({ pageNumber: i + 1, text })),
  };
}

/**
 * Cheap PDF page counter used at upload time. Reads only the PDF's page-tree
 * metadata via getDocumentProxy (no per-page text extraction), so counting a
 * large deck is fast. The full text extraction is deferred to the configure
 * screen (see ensurePresentationExtracted).
 */
export async function countPdfPages(buffer: ArrayBuffer): Promise<number> {
  const pdf = await getDocumentProxy(buffer);
  return pdf.numPages;
}
