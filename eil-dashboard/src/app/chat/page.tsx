import PrimaryNavigation from "@/components/PrimaryNavigation";
import ChatClient from "@/components/chat/ChatClient";

export default function ChatPage() {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 md:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <PrimaryNavigation />
        <ChatClient />
      </div>
    </main>
  );
}
