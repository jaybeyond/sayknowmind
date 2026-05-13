/**
 * Property 44: Google Drive export/download formats stay ingestible
 *
 * Google Sheets exports as text/csv and iOS camera uploads often arrive from
 * Drive as image/heif or image/heic. The connector import path feeds those
 * MIME types into parseFile(), so they must not be rejected as unsupported.
 */
import { describe, expect, it } from "vitest";
import { parseFile } from "@/lib/ingest/parsers";

describe("Property 44: Drive import parser compatibility", () => {
  it("accepts Google Sheets CSV exports", async () => {
    const parsed = await parseFile(
      Buffer.from("name,value\nalpha,1\nbeta,2\n", "utf8"),
      "text/csv",
      "sheet.csv",
    );

    expect(parsed.fileType).toBe("csv");
    expect(parsed.content).toContain("alpha,1");
    expect(parsed.wordCount).toBeGreaterThan(0);
  });

  it("accepts HEIC/HEIF images from Drive as image documents", async () => {
    const parsed = await parseFile(
      Buffer.from("placeholder image bytes"),
      "image/heif",
      "IMG_4009.HEIC",
    );

    expect(parsed.fileType).toBe("image");
    expect(parsed.title).toBe("IMG_4009");
    expect(parsed.content).toContain("[Image: IMG_4009.HEIC]");
  });
});

