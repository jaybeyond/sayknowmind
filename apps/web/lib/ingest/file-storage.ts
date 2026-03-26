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

export async function deleteFile(relativePath: string): Promise<void> {
  try {
    await unlink(join(UPLOADS_DIR, relativePath));
  } catch {
    // File may already be deleted
  }
}
