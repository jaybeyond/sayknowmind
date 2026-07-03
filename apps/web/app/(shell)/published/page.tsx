import { MemoryHeader } from "@/components/dashboard/header";
import { PublishedContent } from "@/components/dashboard/published-content";

export default function PublishedPage() {
  return (
    <div className="lg:border lg:rounded-md overflow-hidden flex flex-col items-center justify-start bg-container h-full w-full bg-background">
      <MemoryHeader titleKey="sidebar.published" />
      <PublishedContent />
    </div>
  );
}
