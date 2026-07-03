import { MemoryHeader } from "@/components/dashboard/header";
import { FavoritesContent } from "@/components/dashboard/favorites-content";

export default function FavoritesPage() {
  return (
    <div className="lg:border lg:rounded-md overflow-hidden flex flex-col items-center justify-start bg-container h-full w-full bg-background">
      <MemoryHeader titleKey="sidebar.favorites" />
      <FavoritesContent />
    </div>
  );
}
