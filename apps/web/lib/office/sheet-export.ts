// Client-side export of a Univer sheet snapshot (IWorkbookData) to CSV / XLSX.
//
// CSV is value-only (the format has no styles); XLSX is full-fidelity: values,
// formulas, number formats, fonts, fills, alignment, borders, merged cells,
// column widths, row heights and frozen panes — mapped from the Univer snapshot
// onto exceljs. exceljs is dynamically imported so it never enters the initial
// bundle; it loads only when the user actually exports an .xlsx.
//
// Univer model reference (@univerjs/core 0.25):
//   cell  ICellData   { v, t, f, s, p }   s = IStyleData | styleId
//   style IStyleData  { ff fs bl it ul st cl bg bd n ht vt tb }
//   sheet IWorksheetData { cellData, mergeData, rowData, columnData, freeze,
//                          defaultColumnWidth, defaultRowHeight }
//   book  IWorkbookData  { sheets, sheetOrder, styles }

export interface SheetData {
  name: string;
  rows: (string | number | boolean | null)[][];
}

// ── plain-text / CSV (value-only) ────────────────────────────────────────────

/** Plain text from a Univer rich-text cell (cell.p is an IDocumentData). */
function richTextPlain(p: any): string {
  const ds = p?.body?.dataStream;
  return typeof ds === "string" ? ds.replace(/[\u0000-\u0020]+/g, " ").trim() : "";
}

/** Coerce a Univer cell to a CSV/value primitive (formula result, value, or rich text). */
function cellPrimitive(cell: any): string | number | boolean | null {
  if (!cell || typeof cell !== "object") return null;
  const v = cell.v;
  if (v !== undefined && v !== null && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) {
    return v;
  }
  if (cell.p) {
    const t = richTextPlain(cell.p);
    return t || null;
  }
  return null;
}

/** Parse a Univer IWorkbookData snapshot into dense per-sheet value matrices. */
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
        if (cellPrimitive(cols[cKey]) !== null) {
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
      for (let c = 0; c <= maxCol; c++) row.push(cellPrimitive(cols[c]));
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

// ── shared download helpers ──────────────────────────────────────────────────

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

function sanitizeSheetName(name: string, fallback: string): string {
  const cleaned = name.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31);
  return cleaned || fallback;
}

/** Download the active sheet as CSV. Returns false when there is no sheet data. */
export function exportCsv(snapshot: unknown, filename: string, sheetName?: string): boolean {
  const sheets = extractSheets(snapshot);
  if (sheets.length === 0) return false;
  const sheet = (sheetName && sheets.find((s) => s.name === sheetName)) || sheets[0];
  // Prepend a UTF-8 BOM so Excel opens non-ASCII (e.g. Korean) text correctly.
  const csv = "\uFEFF" + sheetToCsv(sheet);
  triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), withExt(filename, "csv"));
  return true;
}

// ── full-fidelity XLSX ───────────────────────────────────────────────────────

const PX_PER_POINT = 96 / 72; // CSS px ↔ Excel points
const H_ALIGN: Record<number, string> = { 1: "left", 2: "center", 3: "right", 4: "justify", 5: "justify", 6: "distributed" };
const V_ALIGN: Record<number, string> = { 1: "top", 2: "middle", 3: "bottom" };
const BORDER_STYLE: Record<number, string> = {
  1: "thin", 2: "hair", 3: "dotted", 4: "dashed", 5: "dashDot", 6: "dashDotDot",
  7: "double", 8: "medium", 9: "mediumDashed", 10: "mediumDashDot", 11: "mediumDashDotDot",
  12: "slantDashDot", 13: "thick",
};

/** Univer IColorStyle.rgb (#rgb, #rrggbb, rgb(r,g,b)) → exceljs ARGB (FFRRGGBB). */
function toArgb(color: any): string | undefined {
  const rgb: unknown = color?.rgb;
  if (typeof rgb !== "string" || !rgb) return undefined;
  let s = rgb.trim();
  const m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const parts = m[1].split(",").map((p) => parseFloat(p.trim()));
    const [r, g, b] = parts;
    if ([r, g, b].some((n) => Number.isNaN(n))) return undefined;
    const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
    return `FF${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
  }
  s = s.replace(/^#/, "");
  if (s.length === 3) s = s.split("").map((ch) => ch + ch).join("");
  if (s.length === 6) return `FF${s}`.toUpperCase();
  if (s.length === 8) return s.toUpperCase(); // already AARRGGBB-ish
  return undefined;
}

/** Resolve a cell/row/column style ref (inline IStyleData or a styles-map id). */
function resolveStyle(s: unknown, styles: Record<string, any>): any | undefined {
  if (!s) return undefined;
  if (typeof s === "string") return styles[s];
  if (typeof s === "object") return s;
  return undefined;
}

/** Map a Univer IStyleData onto an exceljs cell. */
function applyStyle(cell: any, style: any): void {
  if (!style || typeof style !== "object") return;

  // number format
  if (style.n?.pattern) cell.numFmt = String(style.n.pattern);

  // font
  const font: any = {};
  if (style.ff) font.name = String(style.ff);
  if (typeof style.fs === "number") font.size = style.fs;
  if (style.bl === 1) font.bold = true;
  if (style.it === 1) font.italic = true;
  if (style.ul?.s === 1) font.underline = true;
  if (style.st?.s === 1) font.strike = true;
  const fg = toArgb(style.cl);
  if (fg) font.color = { argb: fg };
  if (Object.keys(font).length > 0) cell.font = font;

  // fill (solid background)
  const bg = toArgb(style.bg);
  if (bg) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };

  // alignment
  const alignment: any = {};
  if (style.ht && H_ALIGN[style.ht]) alignment.horizontal = H_ALIGN[style.ht];
  if (style.vt && V_ALIGN[style.vt]) alignment.vertical = V_ALIGN[style.vt];
  if (style.tb === 3) alignment.wrapText = true; // WrapStrategy.WRAP
  if (Object.keys(alignment).length > 0) cell.alignment = alignment;

  // borders
  const bd = style.bd;
  if (bd && typeof bd === "object") {
    const sides: Array<[string, string]> = [["t", "top"], ["r", "right"], ["b", "bottom"], ["l", "left"]];
    const border: any = {};
    for (const [uk, ek] of sides) {
      const side = bd[uk];
      if (side && BORDER_STYLE[side.s]) {
        const edge: any = { style: BORDER_STYLE[side.s] };
        const col = toArgb(side.cl);
        if (col) edge.color = { argb: col };
        border[ek] = edge;
      }
    }
    if (Object.keys(border).length > 0) cell.border = border;
  }
}

/** Set an exceljs cell's value, preserving formulas and forced-string typing. */
function applyValue(cell: any, c: any): void {
  if (!c || typeof c !== "object") return;
  if (c.f) {
    const formula = String(c.f).replace(/^=/, "");
    const result = (typeof c.v === "string" || typeof c.v === "number" || typeof c.v === "boolean") ? c.v : undefined;
    cell.value = { formula, result };
    return;
  }
  const v = c.v;
  if (v !== undefined && v !== null && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) {
    if (c.t === 4 /* FORCE_STRING */) {
      cell.value = String(v);
      if (!cell.numFmt) cell.numFmt = "@";
    } else {
      cell.value = v;
    }
    return;
  }
  if (c.p) {
    const t = richTextPlain(c.p);
    if (t) cell.value = t;
  }
}

/**
 * Build a full-fidelity .xlsx buffer (all sheets, styles, formulas, merges,
 * geometry) from a Univer snapshot. Returns null when there are no sheets.
 * Pure (no DOM) so it is unit-testable in Node.
 */
export async function buildXlsxBuffer(snapshot: unknown): Promise<ArrayBuffer | null> {
  if (!snapshot || typeof snapshot !== "object") return null;
  const snap = snapshot as any;
  const sheets = snap.sheets ?? {};
  const order: string[] = Array.isArray(snap.sheetOrder) ? snap.sheetOrder : Object.keys(sheets);
  if (order.length === 0) return null;
  const styles: Record<string, any> = snap.styles ?? {};

  const mod: any = await import("exceljs");
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();

  order.forEach((id, i) => {
    const sheet = sheets[id];
    if (!sheet) return;
    const name = sanitizeSheetName(typeof sheet.name === "string" && sheet.name ? sheet.name : id, `Sheet${i + 1}`);
    const ws = wb.addWorksheet(name);
    const cellData = sheet.cellData ?? {};

    // cells: values + formulas + styles
    for (const rKey of Object.keys(cellData)) {
      const r = Number(rKey);
      if (Number.isNaN(r)) continue;
      const cols = cellData[rKey] ?? {};
      const xlsxRow = ws.getRow(r + 1);
      for (const cKey of Object.keys(cols)) {
        const c = Number(cKey);
        if (Number.isNaN(c)) continue;
        const uCell = cols[cKey];
        if (!uCell) continue;
        const xCell = xlsxRow.getCell(c + 1);
        applyValue(xCell, uCell);
        applyStyle(xCell, resolveStyle(uCell.s, styles));
      }
    }

    // merged ranges
    const merges = Array.isArray(sheet.mergeData) ? sheet.mergeData : [];
    for (const m of merges) {
      if (!m) continue;
      const { startRow, startColumn, endRow, endColumn } = m;
      if ([startRow, startColumn, endRow, endColumn].some((n) => typeof n !== "number")) continue;
      try {
        ws.mergeCells(startRow + 1, startColumn + 1, endRow + 1, endColumn + 1);
      } catch {
        /* overlapping/invalid merge — skip */
      }
    }

    // column widths (Univer px → Excel character width ≈ (px - 5) / 7)
    const columnData = sheet.columnData ?? {};
    for (const cKey of Object.keys(columnData)) {
      const c = Number(cKey);
      if (Number.isNaN(c)) continue;
      const col = columnData[cKey] ?? {};
      const column = ws.getColumn(c + 1);
      if (typeof col.w === "number") column.width = Math.max(1, (col.w - 5) / 7);
      if (col.hd === 1) column.hidden = true;
    }

    // row heights (Univer px → Excel points)
    const rowData = sheet.rowData ?? {};
    for (const rKey of Object.keys(rowData)) {
      const r = Number(rKey);
      if (Number.isNaN(r)) continue;
      const rd = rowData[rKey] ?? {};
      const row = ws.getRow(r + 1);
      if (typeof rd.h === "number") row.height = rd.h / PX_PER_POINT;
      if (rd.hd === 1) row.hidden = true;
    }

    // sheet defaults
    if (typeof sheet.defaultColumnWidth === "number") ws.properties.defaultColWidth = Math.max(1, (sheet.defaultColumnWidth - 5) / 7);
    if (typeof sheet.defaultRowHeight === "number") ws.properties.defaultRowHeight = sheet.defaultRowHeight / PX_PER_POINT;

    // frozen panes
    const fz = sheet.freeze;
    if (fz && (fz.xSplit > 0 || fz.ySplit > 0)) {
      ws.views = [{ state: "frozen", xSplit: fz.xSplit || 0, ySplit: fz.ySplit || 0 }];
    }
  });

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/**
 * Download the whole workbook as a full-fidelity .xlsx. Returns false when the
 * snapshot has no sheets.
 */
export async function exportXlsx(snapshot: unknown, filename: string): Promise<boolean> {
  const buf = await buildXlsxBuffer(snapshot);
  if (!buf) return false;
  triggerDownload(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    withExt(filename, "xlsx"),
  );
  return true;
}
