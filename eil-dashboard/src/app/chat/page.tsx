import PrimaryNavigation from "@/components/PrimaryNavigation";
import ChatClient from "@/components/chat/ChatClient";

export default function ChatPage() {
  return (
    <main className="min-h-screen bg-[#f7f7f8]">
      <div className="border-b border-gray-200 bg-white px-4 py-4 md:px-8">
        <div className="mx-auto max-w-5xl">
          <PrimaryNavigation />
        </div>
      </div>
      <div className="mx-auto max-w-6xl">
        <ChatClient />
      </div>
    </main>
  );
}
