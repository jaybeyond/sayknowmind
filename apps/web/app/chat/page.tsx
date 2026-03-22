import { SidebarProvider } from "@/components/ui/sidebar";
import { BookmarksSidebar } from "@/components/dashboard/sidebar";
import { ChatPage } from "@/components/chat/chat-page";

export default function Chat() {
  return (
    <SidebarProvider>
      <BookmarksSidebar />
      <ChatPage />
    </SidebarProvider>
  );
}
