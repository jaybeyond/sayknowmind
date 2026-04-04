/**
 * Netscape Bookmark HTML parser.
 *
 * All major browsers (Chrome, Firefox, Safari, Edge) export bookmarks
 * in the Netscape Bookmark File Format:
 *   <DT><A HREF="..." ADD_DATE="..." TAGS="...">Title</A>
 *   <DT><H3>Folder Name</H3><DL>...children...</DL>
 */
import * as cheerio from "cheerio";

export interface BookmarkEntry {
  url: string;
  title: string;
  tags: string[];
  folder: string;
  addDate: Date | null;
}

/**
 * Quick check: does the HTML look like a Netscape bookmark file?
 */
export function isBookmarkHtml(html: string): boolean {
  const head = html.slice(0, 512).toUpperCase();
  return head.includes("<!DOCTYPE NETSCAPE-BOOKMARK") || head.includes("NETSCAPE-BOOKMARK-FILE");
}

/**
 * Parse a Netscape Bookmark HTML file into a flat list of BookmarkEntry.
 */
export function parseBookmarkHtml(html: string): BookmarkEntry[] {
  const $ = cheerio.load(html, { xml: false });
  const entries: BookmarkEntry[] = [];

  function walk(container: cheerio.Cheerio, folderPath: string) {
    container.children("dt").each((_, dt) => {
      const $dt = $(dt);

      // Folder: <DT><H3>Name</H3> followed by <DL>
      const h3 = $dt.children("h3");
      if (h3.length) {
        const folderName = h3.text().trim();
        const nestedDl = $dt.children("dl");
        if (nestedDl.length) {
          const subPath = folderPath ? `${folderPath}/${folderName}` : folderName;
          walk(nestedDl, subPath);
        }
        return;
      }

      // Bookmark: <DT><A HREF="...">Title</A>
      const anchor = $dt.children("a");
      if (!anchor.length) return;

      const href = anchor.attr("href");
      if (!href || (!href.startsWith("http://") && !href.startsWith("https://"))) return;

      const addDateStr = anchor.attr("add_date");
      let addDate: Date | null = null;
      if (addDateStr) {
        const ts = parseInt(addDateStr, 10);
        if (!isNaN(ts)) addDate = new Date(ts * 1000);
      }

      const tagsStr = anchor.attr("tags") ?? "";
      const tags = tagsStr
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      entries.push({
        url: href,
        title: anchor.text().trim() || new URL(href).hostname,
        tags,
        folder: folderPath,
        addDate,
      });
    });
  }

  // Start from each top-level <DL>
  $("dl").first().each((_, dl) => {
    walk($(dl), "");
  });

  return entries;
}
