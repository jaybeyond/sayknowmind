// Client-side export of a Univer sheet snapshot (IWorkbookData) to CSV / XLSX.
// Pure data helpers (extractSheets, sheetToCsv) are SSR-safe; the download/xlsx
// helpers touch `document` + lazy-load exceljs, so only call them in the browser
// from a user gesture. exceljs is dynamically imported so it never enters the
// initial bundle — it loads only when the user actually exports.

export interface SheetData {
  name: string;
  rows: (string | number | boolean | null)[][];
}

/** Coerce a Univer cell value to a CSV/XLSX-friendly primitive. */
function cellValue(cell: any): string | number | boolean | null {
  if (!cell || typeof cell !== "object") return null;
  const v = cell.v;
  if (v === undefined || v === null) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  return String(v);
}

/** Parse a Univer IWorkbookData snapshot into dense per-sheet row matrices. */
export function extractSheets(snapshot: unknown): SheetData[] {
  if (!snapshot || typeof snapshot !== "object") return [];
  const snap = snapshot as any;
  const sheets = snap.sheets ?? {};
  const order: string[] = Array.isArray(snap.sheetOrder) ? snap.sheetOrder : Object.keys(sheets);
  const out: SheetData[] = [];

  for (const id of order) {
    const sheet = sheets[id];
    if (!sheet) continue;
    const name = typeof sheet.name === "string" && sheet.name ? sheet.name : id;
    const cellData = sheet.cellData ?? {};

    let maxRow = -1;
    let maxCol = -1;
    for (const rKey of Object.keys(cellData)) {
      const r = Number(rKey);
      if (Number.isNaN(r)) continue;
      const cols = cellData[rKey] ?? {};
      let rowHasValue = false;
      for (const cKey of Object.keys(cols)) {
        const c = Number(cKey);
        if (Number.isNaN(c)) continue;
        if (cellValue(cols[cKey]) !== null) {
          rowHasValue = true;
          maxCol = Math.max(maxCol, c);
        }
      }
      if (rowHasValue) maxRow = Math.max(maxRow, r);
    }

    const rows: (string | number | boolean | null)[][] = [];
    for (let r = 0; r <= maxRow; r++) {
      const cols = cellData[r] ?? {};
      const row: (string | number | boolean | null)[] = [];
      for (let c = 0; c <= maxCol; c++) row.push(cellValue(cols[c]));
      rows.push(row);
    }
    out.push({ name, rows });
  }
  return out;
}

function csvField(v: string | number | boolean | null): string {
  if (v === null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC-4180 CSV for a single sheet (CSV has no multi-sheet concept). */
export function sheetToCsv(sheet: SheetData): string {
  return sheet.rows.map((row) => row.map(csvField).join(",")).join("\r\n");
}

/** Excel sheet names: ≤31 chars, none of []:*?/\ */
function sanitizeSheetName(name: string, fallback: string): string {
  const cleaned = name.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31);
  return cleaned || fallback;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function withExt(filename: string, ext: string): string {
  return filename.toLowerCase().endsWith(`.${ext}`) ? filename : `${filename}.${ext}`;
}

/** Download the active sheet as CSV. Returns false when there is no sheet data. */
export function exportCsv(snapshot: unknown, filename: string, sheetName?: string): boolean {
  const sheets = extractSheets(snapshot);
  if (sheets.length === 0) return false;
  const sheet = (sheetName && sheets.find((s) => s.name === sheetName)) || sheets[0];
  // Prepend a UTF-8 BOM so Excel opens non-ASCII (e.g. Korean) text correctly.
  const csv = "﻿" + sheetToCsv(sheet);
  triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), withExt(filename, "csv"));
  return true;
}

/** Download the whole workbook as .xlsx (all sheets). Returns false when empty. */
export async function exportXlsx(snapshot: unknown, filename: string): Promise<boolean> {
  const sheets = extractSheets(snapshot);
  if (sheets.length === 0) return false;
  const mod: any = await import("exceljs");
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();
  sheets.forEach((s, i) => {
    const ws = wb.addWorksheet(sanitizeSheetName(s.name, `Sheet${i + 1}`));
    if (s.rows.length > 0) ws.addRows(s.rows);
  });
  const buf: ArrayBuffer = await wb.xlsx.writeBuffer();
  triggerDownload(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    withExt(filename, "xlsx"),
  );
  return true;
}
