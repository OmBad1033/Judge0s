import { extractText } from 'unpdf';
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

export async function extractPdfSlides(file: File): Promise<ExtractedPresentation> {
  const buffer = await file.arrayBuffer();
  const result = await extractText(buffer, { mergePages: false });
  const pages = (result.text ?? []).map(clean);

  return {
    source: 'pdf',
    fileName: file.name,
    slideCount: result.totalPages ?? pages.length,
    extractedAt: now(),
    slides: pages.map((text, i) => ({ pageNumber: i + 1, text })),
  };
}
