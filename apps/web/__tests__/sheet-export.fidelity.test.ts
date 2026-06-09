import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildXlsxBuffer } from "../lib/office/sheet-export";

// A snapshot exercising every mapped feature, in the real Univer 0.25 shape.
const snapshot = {
  sheetOrder: ["s1"],
  styles: {
    h: {
      bl: 1, // bold
      it: 1, // italic
      cl: { rgb: "#FF0000" }, // font color red
      bg: { rgb: "#FFFF00" }, // fill yellow
      ht: 2, // center
      ul: { s: 1 }, // underline
      bd: { b: { s: 1, cl: { rgb: "#000000" } } }, // bottom thin black border
    },
  },
  sheets: {
    s1: {
      id: "s1",
      name: "Report",
      freeze: { xSplit: 0, ySplit: 1, startRow: 1, startColumn: 0 },
      mergeData: [{ startRow: 2, startColumn: 0, endRow: 2, endColumn: 1 }],
      columnData: { "0": { w: 200 } },
      rowData: { "0": { h: 48 } },
      cellData: {
        "0": { "0": { v: "Name", s: "h" }, "1": { v: 0.25, s: { n: { pattern: "0.00%" } } } },
        "1": { "0": { f: "=1+2", v: 3 } },
        "2": { "0": { v: "merged title" } },
      },
    },
  },
};

describe("buildXlsxBuffer — full fidelity", () => {
  it("preserves values, formula, styles, merge, geometry and freeze", async () => {
    const buf = await buildXlsxBuffer(snapshot);
    expect(buf).toBeTruthy();

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as ArrayBuffer);
    const ws = wb.getWorksheet("Report");
    expect(ws).toBeTruthy();

    // A1: value + bold/italic/underline + color + fill + center + bottom border
    const a1 = ws!.getCell("A1");
    expect(a1.value).toBe("Name");
    expect(a1.font?.bold).toBe(true);
    expect(a1.font?.italic).toBe(true);
    expect(a1.font?.underline).toBe(true);
    expect(a1.font?.color?.argb).toBe("FFFF0000");
    expect((a1.fill as any)?.fgColor?.argb).toBe("FFFFFF00");
    expect(a1.alignment?.horizontal).toBe("center");
    expect(a1.border?.bottom?.style).toBe("thin");

    // B1: number format preserved
    const b1 = ws!.getCell("B1");
    expect(b1.value).toBe(0.25);
    expect(b1.numFmt).toBe("0.00%");

    // A2: formula preserved (exceljs strips the leading "=")
    const a2 = ws!.getCell("A2");
    expect((a2.value as any)?.formula).toBe("1+2");
    expect((a2.value as any)?.result).toBe(3);

    // merge A3:B3
    expect(ws!.getCell("A3").isMerged).toBe(true);
    expect(ws!.getCell("B3").isMerged).toBe(true);

    // column A width: (200 - 5) / 7 ≈ 27.86
    expect(ws!.getColumn(1).width).toBeCloseTo((200 - 5) / 7, 1);

    // row 1 height: 48 px → 36 pt
    expect(ws!.getRow(1).height).toBeCloseTo(48 / (96 / 72), 1);

    // frozen: 1 row
    expect(ws!.views?.[0]?.state).toBe("frozen");
    expect((ws!.views?.[0] as any)?.ySplit).toBe(1);
  });
});
