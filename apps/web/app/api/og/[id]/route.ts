import { NextRequest, NextResponse } from "next/server";
import { getDocument } from "@/lib/ingest/document-store";
import { getFile } from "@/lib/ingest/file-storage";
import { cacheOgImageForDocument } from "@/lib/ingest/og-image";
import { getOrgContext } from "@/lib/org-context";
import { pool } from "@/lib/db";
import { readableClause } from "@/lib/visibility";

const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#1D1D1D"/>
  <text x="600" y="300" text-anchor="middle" fill="#666" font-family="system-ui,sans-serif" font-size="48">Mind</text>
  <text x="600" y="360" text-anchor="middle" fill="#444" font-family="system-ui,sans-serif" font-size="20">Image unavailable</text>
</svg>`;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: documentId } = await params;
  const debug = request.nextUrl.searchParams.get("debug") === "1";
  const trace: Record<string, unknown> = { documentId };

  const doc = await getDocument(documentId);
  if (!doc) {
    trace.error = "document not found";
    if (debug) return NextResponse.json(trace);
    return servePlaceholder();
  }

  // OG images are fetched unauthenticated by crawlers/unfurlers, so for those we
  // only expose documents the owner explicitly shared — this avoids using the
  // endpoint as a document-existence oracle. An authenticated owner may also view
  // their own (private) document thumbnails, which the dashboard feed relies on.
  const isShared = (doc as { privacy_level?: string }).privacy_level === "shared";
  let authorized = isShared;
  if (!authorized) {
    // An authenticated viewer with read access — owner, org-visible, per-user
    // share, or team share — may see the thumbnail. Mirror the dashboard feed's
    // readableClause so a private doc shared to a teammate doesn't render a
    // placeholder for them (CODE-REVIEW C15).
    const ctx = await getOrgContext();
    if (ctx) {
      const { rows } = await pool.query(
        `SELECT 1 FROM documents d WHERE d.id = $3 AND ${readableClause("d", 2, 1, "document")} LIMIT 1`,
        [ctx.userId, ctx.organizationId, documentId],
      );
      authorized = rows.length > 0;
    }
  }
  if (!authorized) {
    trace.error = "document not shared";
    if (debug) return NextResponse.json(trace);
    return servePlaceholder();
  }

  // Shared images may live in a public/CDN cache; owner-only (private) ones must not.
  const cacheControl = isShared
    ? "public, max-age=86400, immutable"
    : "private, max-age=86400, immutable";

  const meta = (doc.metadata ?? {}) as Record<string, unknown>;
  trace.docUrl = doc.url;
  trace.ogImage = meta.ogImage;
  trace.ogImageOriginal = meta.ogImageOriginal;
  trace.hasBase64 = typeof meta.ogImageBase64 === "string";

  const contentType = typeof meta.ogImageContentType === "string" ? meta.ogImageContentType : "image/png";

  // Try disk first (uploads/{docId}/og.*)
  const ext = contentType.split("/")[1]?.split(";")[0]?.replace("jpeg", "jpg") || "png";
  const file = await getFile(`${documentId}/og.${ext}`);
  if (file) {
    trace.source = "disk";
    if (debug) return NextResponse.json(trace);
    return new NextResponse(new Uint8Array(file.buffer), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(file.size),
        "Cache-Control": cacheControl,
      },
    });
  }

  // Fallback: base64 from metadata (Railway ephemeral FS)
  const base64 = typeof meta.ogImageBase64 === "string" ? meta.ogImageBase64 : null;
  if (base64) {
    trace.source = "base64";
    if (debug) return NextResponse.json(trace);
    const buffer = Buffer.from(base64, "base64");
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buffer.length),
        "Cache-Control": cacheControl,
      },
    });
  }

  // No stored copy — resolve the external image (from metadata, else by
  // re-scraping the source page), download it, and persist base64 on the row so
  // the next request is served from the DB. SSRF guards live in the shared
  // helper (every candidate URL is re-validated before fetch). Never let a
  // resolve/download/persist error 500 the image request — fall to a placeholder.
  let cached: { base64: string; contentType: string } | null = null;
  try {
    cached = await cacheOgImageForDocument(documentId, doc);
  } catch (err) {
    trace.downloadError = String(err);
  }
  if (cached) {
    trace.source = "downloaded";
    if (debug) return NextResponse.json(trace);
    const buffer = Buffer.from(cached.base64, "base64");
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": cached.contentType,
        "Content-Length": String(buffer.length),
        "Cache-Control": cacheControl,
      },
    });
  }

  trace.source = "placeholder";
  if (debug) return NextResponse.json(trace);
  return servePlaceholder();
}

function servePlaceholder() {
  return new NextResponse(PLACEHOLDER_SVG, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=60",
    },
  });
}
