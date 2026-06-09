// Lightweight, dependency-free helpers/types shared between the office editor
// (office-tab.tsx, which pulls in the heavy Univer bundle) and doc-tabs.tsx.
// Keep this file free of any `@univerjs/*` imports so doc-tabs can use it without
// eagerly loading Univer — the editor itself is lazy-loaded via dynamic(ssr:false).

export type OfficeKind = "sheet";

export const OFFICE_KINDS: readonly OfficeKind[] = ["sheet"] as const;

export function isOfficeKind(kind: unknown): kind is OfficeKind {
  return kind === "sheet";
}

/** Best-effort plaintext extraction from a Univer sheet snapshot (for search / RAG). */
export function extractOfficePlaintext(_kind: OfficeKind, snapshot: unknown): string {
  if (!snapshot || typeof snapshot !== "object") return "";
  const snap = snapshot as any;
  try {
    const out: string[] = [];
    const sheets = snap.sheets ?? {};
    for (const id of Object.keys(sheets)) {
      const cellData = sheets[id]?.cellData ?? {};
      for (const r of Object.keys(cellData)) {
        for (const c of Object.keys(cellData[r] ?? {})) {
          const v = cellData[r][c]?.v;
          if (v !== undefined && v !== null && v !== "") out.push(String(v));
        }
      }
    }
    return out.join(" ");
  } catch {
    /* ignore extraction errors */
  }
  return "";
}
