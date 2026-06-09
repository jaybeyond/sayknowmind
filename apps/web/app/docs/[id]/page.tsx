import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { DocEditorDynamic } from "@/components/docs/doc-editor-dynamic";

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

export default async function DocPage({ params }: PageProps) {
  const { id } = await params;
  const doc = await fetchDoc(id);

  if (!doc) notFound();

  return (
    // h-screen (a definite height) so DocTabs' h-full / flex-1 chain resolves —
    // otherwise the editor and full-page HTML iframe collapse to zero height.
    <main className="h-screen overflow-hidden bg-background">
      <DocEditorDynamic
        docId={doc.id}
        initialTitle={doc.title}
        initialMetadata={doc.metadata}
        collab={!!process.env.NEXT_PUBLIC_COLLAB_WS_URL}
      />
    </main>
  );
}
