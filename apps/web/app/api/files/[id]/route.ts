import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { getDocument } from "@/lib/ingest/document-store";
import { getFile } from "@/lib/ingest/file-storage";

const MIME_MAP: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
  html: "text/html",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

function getMimeType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return MIME_MAP[ext] ?? "application/octet-stream";
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { id: documentId } = await params;

  // Verify document belongs to user
  const doc = await getDocument(documentId);
  if (!doc || doc.user_id !== userId) {
    return NextResponse.json({ message: "Not found" }, { status: 404 });
  }

  const meta = (doc.metadata ?? {}) as Record<string, unknown>;
  const filePath = typeof meta.filePath === "string" ? meta.filePath : null;
  const fileName = typeof meta.fileName === "string" ? meta.fileName : "file";

  if (!filePath) {
    return NextResponse.json({ message: "No file attached" }, { status: 404 });
  }

  const file = await getFile(filePath);
  if (!file) {
    return NextResponse.json({ message: "File not found on disk" }, { status: 404 });
  }

  const mimeType = getMimeType(fileName);
  const isDownload = _request.nextUrl.searchParams.get("download") === "1";

  return new NextResponse(new Uint8Array(file.buffer), {
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(file.size),
      ...(isDownload
        ? { "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"` }
        : { "Content-Disposition": "inline" }),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
