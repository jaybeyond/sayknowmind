/**
 * Hand-written ambient declaration for pdf-parse@1.1.1.
 *
 * The legacy package doesn't ship .d.ts files and @types/pdf-parse is a
 * 7-year-old community type set that doesn't quite match the actual
 * CJS shape. Narrow shape is sufficient — `parsers.ts` only reads
 * `text`, `numpages`, and a few info fields.
 */
declare module "pdf-parse" {
  export interface PdfInfo {
    Title?: string;
    title?: string;
    Author?: string;
    author?: string;
    Subject?: string;
    Keywords?: string;
    Creator?: string;
    Producer?: string;
    CreationDate?: string;
    ModDate?: string;
  }

  export interface PdfData {
    text: string;
    numpages: number;
    numrender: number;
    info?: PdfInfo;
    metadata?: unknown;
    version?: string;
  }

  /** Default export — call with a Buffer to extract text + metadata. */
  function pdfParse(
    dataBuffer: Buffer | Uint8Array,
    options?: { max?: number; version?: string },
  ): Promise<PdfData>;

  export default pdfParse;
}

// The package's index.js has long-standing debug code that opens a
// non-existent fixture path at module load. parsers.ts imports the
// inner module directly to skip that — declare it here so TS can
// resolve the deep path without `any`.
declare module "pdf-parse/lib/pdf-parse.js" {
  import type { PdfData } from "pdf-parse";
  function pdfParse(
    dataBuffer: Buffer | Uint8Array,
    options?: { max?: number; version?: string },
  ): Promise<PdfData>;
  export default pdfParse;
}
