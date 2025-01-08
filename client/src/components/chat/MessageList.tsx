import { useEffect, useRef, useCallback, useState } from "react";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { useUser } from "@/hooks/use-user";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { formatDistance } from "date-fns";
import { Search, Users, File } from "lucide-react";
import type { Message, User, DirectMessage, Channel } from "@db/schema";
import MessageInput from "./MessageInput";

// Extend the base message types to include the user
type ExtendedMessage = (Message | DirectMessage) & {
  user: User;
};

type Props = {
  channelId: number | null;
  userId: number | null;
};

interface PageParam {
  before: string | null;
  after: string | null;
}

interface MessagesResponse {
  data: ExtendedMessage[];
  nextCursor: string | null;
  prevCursor: string | null;
}

const MESSAGES_PER_PAGE = 50;

export default function MessageList({ channelId, userId }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastReadRef = useRef<number | null>(null);
  const { user: currentUser, token } = useUser();
  const observerRef = useRef<IntersectionObserver | null>(null);
  const [scrollPosition, setScrollPosition] = useState<number | null>(null);

  // Query for messages with infinite loading
  const {
    data: messagesData,
    fetchNextPage,
    fetchPreviousPage,
    hasNextPage,
    hasPreviousPage,
    isFetchingNextPage,
    isFetchingPreviousPage,
  } = useInfiniteQuery<MessagesResponse, Error>({
    queryKey: userId ? ["/api/dm", userId] : ["/api/channels", channelId, "messages"],
    queryFn: async ({ pageParam = { before: null, after: null } }) => {
      const url = userId
        ? `/api/dm/${userId}`
        : `/api/channels/${channelId}/messages`;

      const queryParams = new URLSearchParams();
      if ((pageParam as PageParam).before) queryParams.append('before', (pageParam as PageParam).before!);
      if ((pageParam as PageParam).after) queryParams.append('after', (pageParam as PageParam).after!);
      queryParams.append('limit', MESSAGES_PER_PAGE.toString());

      const response = await fetch(`${url}?${queryParams}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error("Failed to fetch messages");
      return response.json();
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.data || lastPage.data.length < MESSAGES_PER_PAGE) return undefined;
      return { before: lastPage.data[0].id.toString(), after: null } as PageParam;
    },
    getPreviousPageParam: (firstPage) => {
      if (!firstPage.data || firstPage.data.length < MESSAGES_PER_PAGE) return undefined;
      return { before: null, after: firstPage.data[firstPage.data.length - 1].id.toString() } as PageParam;
    },
    initialPageParam: { before: null, after: null } as PageParam,
    enabled: !!(channelId || userId),
  });

  // Save scroll position when leaving channel
  useEffect(() => {
    return () => {
      if (scrollRef.current) {
        setScrollPosition(scrollRef.current.scrollTop);
      }
    };
  }, [channelId, userId]);

  // Restore scroll position when returning to channel
  useEffect(() => {
    if (scrollRef.current && scrollPosition !== null) {
      scrollRef.current.scrollTop = scrollPosition;
    }
  }, [scrollPosition, channelId, userId]);

  // Handle infinite scroll
  useEffect(() => {
    const scrollContainer = document.getElementById('scroll-container');
    if (!scrollContainer) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;

      // Load older messages when scrolling up
      if (scrollTop < 100 && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }

      // Load newer messages when scrolling down
      if (scrollHeight - (scrollTop + clientHeight) < 100 && hasPreviousPage && !isFetchingPreviousPage) {
        fetchPreviousPage();
      }
    };

    scrollContainer.addEventListener('scroll', handleScroll);
    return () => scrollContainer.removeEventListener('scroll', handleScroll);
  }, [fetchNextPage, fetchPreviousPage, hasNextPage, hasPreviousPage, isFetchingNextPage, isFetchingPreviousPage]);

  // Update last read message when messages come into view
  const updateLastRead = useCallback(async (messageId: number) => {
    if (!channelId || messageId <= (lastReadRef.current || 0)) return;

    lastReadRef.current = messageId;
    try {
      const response = await fetch(`/api/channels/${channelId}/read`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ messageId }),
      });

      if (!response.ok) {
        console.error('Failed to update last read message');
      }
    } catch (error) {
      console.error('Error updating last read message:', error);
    }
  }, [channelId, token]);

  // Setup intersection observer for message tracking
  useEffect(() => {
    const options = {
      root: document.getElementById('scroll-container'),
      threshold: 0.5,
    };

    observerRef.current = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const messageId = parseInt(entry.target.getAttribute('data-message-id') || '0');
          if (messageId && channelId) {
            updateLastRead(messageId);
          }
        }
      });
    }, options);

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [updateLastRead, channelId]);

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

  const getMessageTitle = () => {
    if (userId && chatPartner) {
      return chatPartner.username;
    }
    if (channelId && channel) {
      return `#${channel.name}`;
    }
    return '';
  };

  if (!channelId && !userId) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Select a channel or user to start chatting
      </div>
    );
  }

  const allMessages = messagesData?.pages.flatMap((page) => page.data) || [];

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

      <ScrollArea id="scroll-container" ref={scrollRef} className="flex-1 p-4">
        {isFetchingNextPage && (
          <div className="text-center py-2">Loading older messages...</div>
        )}
        <div className="space-y-4">
          {allMessages.map((message: ExtendedMessage, i: number) => {
            const previousMessage = allMessages[i - 1];
            const showHeader =
              !previousMessage ||
              previousMessage.user.id !== message.user.id ||
              new Date(message.createdAt!).getTime() -
                new Date(previousMessage.createdAt!).getTime() >
                300000;

            return (
              <div
                key={message.id}
                className="group"
                data-message-id={message.id}
              >
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
                          { addSuffix: true }
                        )}
                      </span>
                    </div>
                  </div>
                )}
                <div className={`pl-12 ${!showHeader ? "mt-1" : ""}`}>
                  <p className="text-gray-800">{message.content}</p>
                </div>
              </div>
            );
          })}
        </div>
        {isFetchingPreviousPage && (
          <div className="text-center py-2">Loading newer messages...</div>
        )}
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