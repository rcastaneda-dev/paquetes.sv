/**
 * Shared utility to add page numbers to buffered PDFKit documents.
 * Must be called AFTER all content is rendered and BEFORE doc.end().
 * Requires the document to have been created with { bufferPages: true }.
 */
import type { PDFDocumentInstance } from './agreement/types';

export function addPageNumbers(doc: PDFDocumentInstance): void {
  const range = doc.bufferedPageRange();
  const totalPages = range.count;

  for (let i = range.start; i < range.start + totalPages; i++) {
    doc.switchToPage(i);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;

    const text = `${i - range.start + 1}`;
    doc.fontSize(8).font('Helvetica').fillColor('black');
    const textWidth = doc.widthOfString(text);
    const x = (pageWidth - textWidth) / 2;

    doc.text(text, x, pageHeight - 20, { lineBreak: false });
  }
}
