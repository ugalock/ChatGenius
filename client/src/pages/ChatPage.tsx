import { useState } from "react";
import { ResizablePanelGroup, ResizablePanel } from "@/components/ui/resizable";
import { Separator } from "@/components/ui/separator";
import ChannelList from "@/components/chat/ChannelList";
import DirectMessages from "@/components/chat/DirectMessages";
import MessageList from "@/components/chat/MessageList";
import UserList from "@/components/chat/UserList";
import { useWebSocket } from "@/hooks/use-websocket";
import { useUser } from "@/hooks/use-user";

export default function ChatPage() {
  const { user, token } = useUser();
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  useWebSocket(user?.id, token);

  return (
    <div className="h-screen bg-gray-100">
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel defaultSize={20} minSize={15}>
          <div className="h-full flex flex-col bg-gray-800 text-white">
            <div className="p-4 border-b border-gray-700">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold">ChatGenius</h2>
              </div>
            </div>
            <ChannelList
              selectedChannelId={selectedChannelId}
              onSelectChannel={setSelectedChannelId}
            />
            <DirectMessages 
              selectedUserId={selectedUserId}
              onSelectUser={setSelectedUserId}
            />
          </div>
        </ResizablePanel>
        <ResizablePanel defaultSize={60}>
          <MessageList channelId={selectedChannelId} />
        </ResizablePanel>
        {/* <ResizablePanel defaultSize={20} minSize={15}>
          <UserList />
        </ResizablePanel> */}
      </ResizablePanelGroup>
    </div>
  );
}