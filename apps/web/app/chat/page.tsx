import { SidebarProvider } from "@/components/ui/sidebar";
import { MemorySidebar } from "@/components/dashboard/sidebar";
import { ChatPage } from "@/components/chat/chat-page";

export const dynamic = "force-dynamic";

export default function Chat() {
  return (
    <SidebarProvider>
      <MemorySidebar />
      <ChatPage />
    </SidebarProvider>
  );
}
