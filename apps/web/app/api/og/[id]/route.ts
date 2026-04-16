import { NextRequest, NextResponse } from "next/server";
import { getDocument } from "@/lib/ingest/document-store";
import { getFile, downloadOgImage } from "@/lib/ingest/file-storage";
import { updateDocument } from "@/lib/ingest/document-store";

const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#1D1D1D"/>
  <text x="600" y="300" text-anchor="middle" fill="#666" font-family="system-ui,sans-serif" font-size="48">Mind</text>
  <text x="600" y="360" text-anchor="middle" fill="#444" font-family="system-ui,sans-serif" font-size="20">Image unavailable</text>
</svg>`;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: documentId } = await params;

  const doc = await getDocument(documentId);
  if (!doc) {
    return servePlaceholder();
  }

  const meta = (doc.metadata ?? {}) as Record<string, unknown>;
  const contentType = typeof meta.ogImageContentType === "string" ? meta.ogImageContentType : "image/png";

  // Try disk first (uploads/{docId}/og.*)
  const ext = contentType.split("/")[1]?.split(";")[0]?.replace("jpeg", "jpg") || "png";
  const file = await getFile(`${documentId}/og.${ext}`);
  if (file) {
    return new NextResponse(new Uint8Array(file.buffer), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(file.size),
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  }

  // Fallback: base64 from metadata (Railway ephemeral FS)
  const base64 = typeof meta.ogImageBase64 === "string" ? meta.ogImageBase64 : null;
  if (base64) {
    const buffer = Buffer.from(base64, "base64");
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buffer.length),
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  }

  // Find external URL or re-fetch from document page
  const docUrl = doc.url as string | null;
  const externalUrl = findExternalUrl(meta) ?? await fetchOgImageFromPage(docUrl);
  console.log(`[og-proxy] ${documentId}: docUrl=${docUrl}, externalUrl=${externalUrl}`);

  if (externalUrl) {
    try {
      const result = await downloadOgImage(documentId, externalUrl);
      if (result) {
        // Cache for next time
        updateDocument(documentId, {
          metadata: {
            ogImage: `/api/og/${documentId}`,
            ogImageOriginal: externalUrl,
            ogImageBase64: result.base64,
            ogImageContentType: result.contentType,
          },
        }).catch(() => {});

        const buffer = Buffer.from(result.base64, "base64");
        return new NextResponse(new Uint8Array(buffer), {
          headers: {
            "Content-Type": result.contentType,
            "Content-Length": String(buffer.length),
            "Cache-Control": "public, max-age=86400, immutable",
          },
        });
      }
    } catch (err) {
      console.error(`[og-proxy] download failed for ${documentId}:`, err);
    }
  }

  return servePlaceholder();
}

function findExternalUrl(meta: Record<string, unknown>): string | null {
  if (typeof meta.ogImageOriginal === "string" && meta.ogImageOriginal.startsWith("http")) {
    return meta.ogImageOriginal;
  }
  if (typeof meta.ogImage === "string" && meta.ogImage.startsWith("http")) {
    return meta.ogImage;
  }
  return null;
}

/** Fetch the document's page and extract og:image from HTML meta tags */
async function fetchOgImageFromPage(docUrl: string | null): Promise<string | null> {
  if (!docUrl || !docUrl.startsWith("http")) return null;
  try {
    const res = await fetch(docUrl, {
      headers: { "User-Agent": "SayknowMind-Bot/1.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    // Extract og:image or twitter:image
    const match = html.match(
      /<meta[^>]+(?:property=["']og:image["']|name=["']twitter:image["'])[^>]+content=["']([^"']+)["']/i
    ) ?? html.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property=["']og:image["']|name=["']twitter:image["'])/i
    );
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function servePlaceholder() {
  return new NextResponse(PLACEHOLDER_SVG, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=60",
    },
  });
}
