import { NextRequest, NextResponse } from "next/server";
import { getDocument } from "@/lib/ingest/document-store";
import { getFile, downloadOgImage } from "@/lib/ingest/file-storage";
import { updateDocument } from "@/lib/ingest/document-store";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: documentId } = await params;

  const doc = await getDocument(documentId);
  if (!doc) {
    return NextResponse.json({ message: "Not found" }, { status: 404 });
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

  // Lazy cache: external URL exists but not cached yet — download, cache, serve
  const externalUrl = typeof meta.ogImageOriginal === "string"
    ? meta.ogImageOriginal
    : typeof meta.ogImage === "string" && meta.ogImage.startsWith("http")
      ? meta.ogImage
      : null;

  if (externalUrl) {
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
  }

  return NextResponse.json({ message: "Image not available" }, { status: 404 });
}
