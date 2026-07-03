import { getDocument, updateDocument } from "./document-store";
import { downloadOgImage } from "./file-storage";
import { validateUrl, safeFetch } from "./url-fetcher";

/** SSRF guard: true only if the URL is well-formed and resolves to a public address. */
export async function isSafeOgUrl(url: string | null | undefined): Promise<boolean> {
  if (!url) return false;
  try {
    await validateUrl(url);
    return true;
  } catch {
    return false;
  }
}

/** Pick an already-known external og image URL out of a document's metadata. */
export function findExternalOgUrl(meta: Record<string, unknown>): string | null {
  if (typeof meta.ogImageOriginal === "string" && meta.ogImageOriginal.startsWith("http")) {
    return meta.ogImageOriginal;
  }
  if (typeof meta.ogImage === "string" && meta.ogImage.startsWith("http")) {
    return meta.ogImage;
  }
  return null;
}

/** Fetch the document's page and extract og:image / twitter:image from the HTML meta tags. */
export async function fetchOgImageFromPage(docUrl: string | null | undefined): Promise<string | null> {
  if (!docUrl || !docUrl.startsWith("http")) return null;
  try {
    const res = await safeFetch(docUrl, {
      headers: { "User-Agent": "SayknowMind-Bot/1.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match =
      html.match(
        /<meta[^>]+(?:property=["']og:image["']|name=["']twitter:image["'])[^>]+content=["']([^"']+)["']/i,
      ) ??
      html.match(
        /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property=["']og:image["']|name=["']twitter:image["'])/i,
      );
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

type DocLike = { url?: unknown; metadata?: unknown };

/**
 * Resolve the external og image URL for a document — from its metadata first,
 * else by re-scraping the source page. Every candidate is SSRF-guarded (private /
 * internal targets rejected) before it's returned.
 */
export async function resolveExternalOgUrl(doc: DocLike): Promise<string | null> {
  const meta = (doc.metadata ?? {}) as Record<string, unknown>;
  const fromMeta = findExternalOgUrl(meta);
  if (fromMeta) return (await isSafeOgUrl(fromMeta)) ? fromMeta : null;

  const docUrl = typeof doc.url === "string" ? doc.url : null;
  if (!(await isSafeOgUrl(docUrl))) return null;
  const fromPage = await fetchOgImageFromPage(docUrl);
  return fromPage && (await isSafeOgUrl(fromPage)) ? fromPage : null;
}

/**
 * Download the document's og image and persist it as base64 on the row — the
 * durable, Railway-safe copy — plus a best-effort disk cache. Idempotent to call:
 * re-runs simply refresh the stored bytes. Returns the cached bytes, or null when
 * no image could be resolved or fetched.
 */
export async function cacheOgImageForDocument(
  documentId: string,
  doc?: DocLike,
): Promise<{ base64: string; contentType: string } | null> {
  const d = (doc ?? (await getDocument(documentId))) as DocLike | null;
  if (!d) return null;

  const externalUrl = await resolveExternalOgUrl(d);
  if (!externalUrl) return null;

  const docUrl = typeof d.url === "string" ? d.url : undefined;
  const result = await downloadOgImage(documentId, externalUrl, docUrl);
  if (!result) return null;

  await updateDocument(documentId, {
    metadata: {
      ogImage: `/api/og/${documentId}`,
      // Preserve the source URL so a later re-fetch/backfill can find it even
      // after `ogImage` has been rewritten to the /api/og/{id} proxy path.
      ogImageOriginal: externalUrl,
      ogImageBase64: result.base64,
      ogImageContentType: result.contentType,
    },
  });

  return { base64: result.base64, contentType: result.contentType };
}
