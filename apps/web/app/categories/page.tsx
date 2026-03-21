import { BookmarksSidebar } from "@/components/dashboard/sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { CategoryManager } from "@/components/categories/category-manager";

export default function CategoriesPage() {
  return (
    <SidebarProvider className="bg-sidebar">
      <BookmarksSidebar />
      <div className="h-svh overflow-hidden lg:p-2 w-full">
        <div className="lg:border lg:rounded-md overflow-hidden flex flex-col bg-container h-full w-full bg-background">
          <CategoryManager />
        </div>
      </div>
    </SidebarProvider>
  );
}
