import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { MindmapEditorDynamic } from "@/components/docs/mindmap-editor-dynamic";
import type { MindElixirData } from "mind-elixir";

async function fetchDoc(id: string) {
  const hdrs = await headers();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:5400";
  const res = await fetch(`${baseUrl}/api/documents/${id}`, {
    headers: Object.fromEntries(hdrs.entries()),
    cache: "no-store",
  });
  if (res.status === 401) redirect("/auth/login");
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return res.json() as Promise<{
    id: string;
    title: string;
    content: string;
    source_type: string;
    metadata: Record<string, unknown>;
  }>;
}

type PageProps = { params: Promise<{ id: string }> };

export default async function MindmapPage({ params }: PageProps) {
  const { id } = await params;
  const doc = await fetchDoc(id);

  if (!doc) notFound();

  const mindmapData: MindElixirData | null =
    doc.metadata?.mindmap != null &&
    typeof doc.metadata.mindmap === "object" &&
    "nodeData" in (doc.metadata.mindmap as object)
      ? (doc.metadata.mindmap as MindElixirData)
      : null;

  return (
    <main className="h-screen bg-background flex flex-col">
      <MindmapEditorDynamic
        docId={doc.id}
        initialTitle={doc.title}
        initialData={mindmapData}
        collab={!!process.env.NEXT_PUBLIC_COLLAB_WS_URL}
      />
    </main>
  );
}
