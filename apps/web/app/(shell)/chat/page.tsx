import { MemoryHeader } from "@/components/dashboard/header";
import { ChatPage } from "@/components/chat/chat-page";

export default function Chat() {
  return (
    <div className="lg:border lg:rounded-md overflow-hidden flex flex-col bg-container h-full w-full bg-background">
      <MemoryHeader titleKey="sidebar.chat" showFilters={false} />
      <ChatPage />
    </div>
  );
}
