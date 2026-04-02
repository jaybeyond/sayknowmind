import { mkdir, writeFile, readFile, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

const UPLOADS_DIR = join(process.cwd(), "uploads");

function getFilePath(documentId: string, fileName: string): string {
  return join(UPLOADS_DIR, documentId, fileName);
}

export async function saveFile(
  documentId: string,
  fileName: string,
  buffer: Buffer,
): Promise<string> {
  const dir = join(UPLOADS_DIR, documentId);
  await mkdir(dir, { recursive: true });
  const filePath = getFilePath(documentId, fileName);
  await writeFile(filePath, buffer);
  return `${documentId}/${fileName}`;
}

export async function getFile(
  relativePath: string,
): Promise<{ buffer: Buffer; size: number } | null> {
  try {
    const fullPath = join(UPLOADS_DIR, relativePath);
    const info = await stat(fullPath);
    const buffer = await readFile(fullPath);
    return { buffer, size: info.size };
  } catch {
    return null;
  }
}

/**
 * Download an OG image from an external URL and save it locally.
 * Returns { relativePath, base64, contentType } on success, null on failure.
 */
export async function downloadOgImage(
  documentId: string,
  imageUrl: string,
): Promise<{ relativePath: string; base64: string; contentType: string } | null> {
  try {
    const res = await fetch(imageUrl, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "SayKnowMind/0.1" },
      redirect: "follow",
    });
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "image/png";
    if (!contentType.startsWith("image/")) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    // Skip if too large (>2MB) or empty
    if (buffer.length === 0 || buffer.length > 2 * 1024 * 1024) return null;

    const ext = contentType.split("/")[1]?.split(";")[0]?.replace("jpeg", "jpg") || "png";
    const fileName = `og.${ext}`;
    const relativePath = await saveFile(documentId, fileName, buffer);
    const base64 = buffer.toString("base64");

    return { relativePath, base64, contentType };
  } catch {
    return null;
  }
}

export async function deleteFile(relativePath: string): Promise<void> {
  try {
    await unlink(join(UPLOADS_DIR, relativePath));
  } catch {
    // File may already be deleted
  }
}
