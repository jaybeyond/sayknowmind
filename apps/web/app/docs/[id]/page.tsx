import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { DocEditorDynamic } from "@/components/docs/doc-editor-dynamic";
import type { Block } from "@blocknote/core";

async function fetchDoc(id: string) {
  const hdrs = await headers();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
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

export default async function DocPage({ params }: PageProps) {
  const { id } = await params;
  const doc = await fetchDoc(id);

  if (!doc) notFound();

  const blocks: Block[] | null = Array.isArray(doc.metadata?.blocknote)
    ? (doc.metadata.blocknote as Block[])
    : null;

  return (
    <main className="min-h-screen bg-background">
      <DocEditorDynamic
        docId={doc.id}
        initialTitle={doc.title}
        initialBlocks={blocks}
      />
    </main>
  );
}
