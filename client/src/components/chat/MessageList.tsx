import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useUser } from "@/hooks/use-user";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { formatDistance } from "date-fns";
import { Search, Users, File } from "lucide-react";
import type { Message, User, DirectMessage, Channel } from "@db/schema";
import MessageInput from "./MessageInput";

// Extend the base message types to include the user
type ExtendedChannelMessage = Message & {
  user: User;
};

type ExtendedDirectMessage = DirectMessage & {
  user: User;
};

type ExtendedMessage = ExtendedChannelMessage | ExtendedDirectMessage;

type Props = {
  channelId: number | null;
  userId: number | null;
};

export default function MessageList({ channelId, userId }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { user: currentUser, token } = useUser();

  // Query for messages
  const { data: messages } = useQuery<ExtendedMessage[]>({
    queryKey: userId
      ? ["/api/dm", userId]
      : ["/api/channels", channelId, "messages"],
    queryFn: async () => {
      const url = userId
        ? `/api/dm/${userId}`
        : `/api/channels/${channelId}/messages`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error("Failed to fetch messages");

      if (!userId) {
        await fetch(`/api/channels/${channelId}/read`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      }
      return response.json();
    },
    enabled: !!(channelId || userId),
  });

  // Query for chat partner in DM
  const { data: chatPartner } = useQuery<User>({
    queryKey: ["/api/users", userId],
    queryFn: async () => {
      const response = await fetch(`/api/users/${userId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error("Failed to fetch user");
      return response.json();
    },
    enabled: !!userId,
  });

  // Query for channel information
  const { data: channel } = useQuery<Channel>({
    queryKey: ["/api/channels", channelId],
    queryFn: async () => {
      const response = await fetch(`/api/channels/${channelId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error("Failed to fetch channel");
      return response.json();
    },
    enabled: !!channelId,
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  if (!channelId && !userId) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Select a channel or user to start chatting
      </div>
    );
  }

  // Helper function to determine if a message is a channel message
  const isChannelMessage = (
    message: ExtendedMessage,
  ): message is ExtendedChannelMessage => {
    return "channelId" in message;
  };

  const getMessageTitle = () => {
    if (userId && chatPartner) {
      return chatPartner.username;
    }
    if (channelId && channel) {
      return `# ${channel.name}`;
    }
    return userId ? "Direct Message" : "# channel";
  };

  // const subtitle = userId
  //   ? chatPartner?.status === "online"
  //     ? "Active Now"
  //     : "Offline"
  //   : `${messages?.length || 0} messages`;

  return (
    <div className="h-full flex flex-col">
      <div className="bg-white border-b p-4 flex items-center justify-between">
        <div className="flex items-center">
          {userId && chatPartner && (
            <div className="relative">
              <Avatar className="h-8 w-8 mr-2">
                <AvatarImage src={chatPartner.avatar || undefined} />
                <AvatarFallback>
                  {chatPartner.username[0].toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div
                className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white ${
                  chatPartner.status === "online"
                    ? "bg-green-500"
                    : "bg-gray-500"
                }`}
              />
            </div>
          )}
          <div>
            <h2 className="text-xl font-semibold">{getMessageTitle()}</h2>
            {/* <span className="text-sm text-gray-500">{subtitle}</span> */}
          </div>
        </div>
        <div className="flex items-center space-x-4">
          <Search className="w-5 h-5 text-gray-500 cursor-pointer" />
          {!userId && (
            <Users className="w-5 h-5 text-gray-500 cursor-pointer" />
          )}
          <File className="w-5 h-5 text-gray-500 cursor-pointer" />
        </div>
      </div>
      <ScrollArea ref={scrollRef} className="flex-1 p-4">
        <div className="space-y-4">
          {messages?.map((message, i) => {
            const previousMessage = messages[i - 1];
            const showHeader =
              !previousMessage ||
              previousMessage.user.id !== message.user.id ||
              new Date(message.createdAt!).getTime() -
                new Date(previousMessage.createdAt!).getTime() >
                300000;

            return (
              <div key={message.id} className="group">
                {showHeader && (
                  <div className="flex items-center gap-2 mb-2">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={message.user.avatar || undefined} />
                      <AvatarFallback>
                        {message.user.username[0].toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex items-baseline gap-2">
                      <span className="font-semibold">
                        {message.user.username}
                      </span>
                      <span className="text-sm text-gray-500">
                        {formatDistance(
                          new Date(message.createdAt!),
                          new Date(),
                          { addSuffix: true },
                        )}
                      </span>
                    </div>
                  </div>
                )}
                <div className={`pl-12 ${!showHeader ? "mt-1" : ""}`}>
                  <p className="text-gray-800">{message.content}</p>
                  {message.attachments &&
                    typeof message.attachments === "object" && (
                      <div className="mt-2 space-y-2">
                        {Object.entries(
                          message.attachments as Record<string, string>,
                        ).map(([name, url]) => (
                          <a
                            key={name}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-blue-500 hover:underline"
                          >
                            {name}
                          </a>
                        ))}
                      </div>
                    )}
                  {message.reactions &&
                    typeof message.reactions === "object" && (
                      <div className="mt-2 flex gap-1">
                        {Object.entries(
                          message.reactions as Record<string, string[]>,
                        ).map(([emoji, users]) => (
                          <div
                            key={emoji}
                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 rounded-full text-sm cursor-pointer hover:bg-gray-200"
                          >
                            <span>{emoji}</span>
                            <span>{users.length}</span>
                          </div>
                        ))}
                      </div>
                    )}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
      <Separator />
      <div className="p-4">
        <MessageInput
          channelId={channelId}
          userId={userId}
          dmChatName={chatPartner?.username}
        />
      </div>
    </div>
  );
}
