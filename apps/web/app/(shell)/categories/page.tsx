import { MemoryHeader } from "@/components/dashboard/header";
import { CategoryManager } from "@/components/categories/category-manager";

export default function CategoriesPage() {
  return (
    <div className="lg:border lg:rounded-md overflow-hidden flex flex-col bg-container h-full w-full bg-background">
      <MemoryHeader titleKey="sidebar.categories" showFilters={false} />
      <CategoryManager />
    </div>
  );
}
