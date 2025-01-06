import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useUser } from "@/hooks/use-user";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { formatDistance } from "date-fns";
import type { Message, User } from "@db/schema";
import MessageInput from "./MessageInput";

type ExtendedMessage = Message & {
  user: User;
};

type Props = {
  channelId: number | null;
};

export default function MessageList({ channelId }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { user } = useUser();

  const { data: messages } = useQuery<ExtendedMessage[]>({
    queryKey: ["/api/channels", channelId, "messages"],
    enabled: !!channelId
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  if (!channelId) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Select a channel to start chatting
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <ScrollArea ref={scrollRef} className="flex-1 p-4">
        <div className="space-y-4">
          {messages?.map((message, i) => {
            const previousMessage = messages[i - 1];
            const showHeader = !previousMessage || 
              previousMessage.userId !== message.userId ||
              new Date(message.createdAt!).getTime() - new Date(previousMessage.createdAt!).getTime() > 300000;

            return (
              <div key={message.id} className="group">
                {showHeader && (
                  <div className="flex items-center gap-2 mb-2">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={message.user.avatar} />
                      <AvatarFallback>
                        {message.user.username[0].toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex items-baseline gap-2">
                      <span className="font-semibold">
                        {message.user.username}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDistance(new Date(message.createdAt!), new Date(), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                )}
                <div className={`pl-10 ${!showHeader ? "mt-1" : ""}`}>
                  <p className="text-sm">{message.content}</p>
                  {message.attachments && (
                    <div className="mt-2 space-y-2">
                      {Object.entries(message.attachments as Record<string, string>).map(([name, url]) => (
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
                  {message.reactions && (
                    <div className="mt-2 flex gap-1">
                      {Object.entries(message.reactions as Record<string, string[]>).map(([emoji, users]) => (
                        <div
                          key={emoji}
                          className="inline-flex items-center gap-1 px-2 py-0.5 bg-secondary rounded-full text-xs"
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
        <MessageInput channelId={channelId} />
      </div>
    </div>
  );
}
