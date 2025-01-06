import { useState } from "react";
import { ResizablePanelGroup, ResizablePanel } from "@/components/ui/resizable";
import { Separator } from "@/components/ui/separator";
import ChannelList from "@/components/chat/ChannelList";
import MessageList from "@/components/chat/MessageList";
import UserList from "@/components/chat/UserList";
import { useWebSocket } from "@/hooks/use-websocket";
import { useUser } from "@/hooks/use-user";

export default function ChatPage() {
  const { user } = useUser();
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(null);
  useWebSocket(user?.id);

  return (
    <div className="h-screen">
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel defaultSize={20} minSize={15}>
          <ChannelList
            selectedChannelId={selectedChannelId}
            onSelectChannel={setSelectedChannelId}
          />
        </ResizablePanel>
        <ResizablePanel defaultSize={60}>
          <MessageList channelId={selectedChannelId} />
        </ResizablePanel>
        <ResizablePanel defaultSize={20} minSize={15}>
          <UserList />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
