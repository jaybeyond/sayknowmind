import { MemoryHeader } from "@/components/dashboard/header";
import { MemoryContent } from "@/components/dashboard/content";

// The sidebar shell + guest/auth split (AuthGate) now live in the (shell) layout,
// so this page only renders the home content pane. force-dynamic is set on the
// layout, which covers every route in the group.
export default function HomePage() {
  return (
    <div className="lg:border lg:rounded-md overflow-hidden flex flex-col items-center justify-start bg-container h-full w-full bg-background">
      <MemoryHeader />
      <MemoryContent />
    </div>
  );
}
