import JSZip from 'jszip';

/**
 * Client-side slide count for an uploaded presentation file, derived from the
 * file itself so the admin is never asked to type it:
 *  - .pptx → number of `ppt/slides/slideN.xml` entries in the (zip) archive.
 *    Counts every slide including blank ones — same rule the worker uses.
 *  - .pdf  → null (the worker counts pages server-side via its PDF extractor).
 * Returns null for unsupported/unreadable files.
 */
export async function countSlidesInFile(file: File): Promise<number | null> {
  if (/\.pdf$/i.test(file.name)) return null;
  if (!/\.pptx$/i.test(file.name)) return null;
  try {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    return Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name)).length;
  } catch {
    return null;
  }
}
