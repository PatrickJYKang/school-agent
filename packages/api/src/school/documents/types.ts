import type { CanvasErrorCode, SchoolDocumentSettings } from 'librechat-data-provider';

export class DocumentReadError extends Error {
  constructor(public readonly code: CanvasErrorCode) {
    super(code);
  }
}
export type DocumentReadOptions = { start_page?: number; end_page?: number; offset?: number };
export type DocumentReadResult = {
  format: 'pdf' | 'docx' | 'odt' | 'text' | 'html';
  pageCount?: number;
  startPage?: number;
  endPage?: number;
  nextPage?: number;
  offset: number;
  nextOffset?: number;
  totalCharacters: number;
  truncated: boolean;
  text: string;
};
export type DocumentJob = {
  buffer: Uint8Array;
  filename: string;
  mimeType: string;
  settings: SchoolDocumentSettings;
  options: DocumentReadOptions;
  tempPath: string;
  sourceUrl?: string;
};
export type DocumentReply =
  | { ok: true; value: DocumentReadResult }
  | { ok: false; code: CanvasErrorCode };

export function sliceDocumentText(
  text: string,
  options: DocumentReadOptions,
  maxChars: number,
): Pick<DocumentReadResult, 'text' | 'offset' | 'nextOffset' | 'totalCharacters' | 'truncated'> {
  const offset = options.offset ?? 0;
  if (offset > text.length) throw new DocumentReadError('canvas_invalid_request');
  let end = Math.min(text.length, offset + maxChars);
  if (
    end < text.length &&
    /[\uD800-\uDBFF]/.test(text[end - 1]) &&
    /[\uDC00-\uDFFF]/.test(text[end])
  )
    end--;
  return {
    text: text.slice(offset, end),
    offset,
    totalCharacters: text.length,
    nextOffset: end < text.length ? end : undefined,
    truncated: end < text.length,
  };
}
