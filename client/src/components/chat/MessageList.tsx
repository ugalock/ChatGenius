import { useEffect, useRef, useCallback } from "react";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { useUser } from "@/hooks/use-user";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { formatDistance } from "date-fns";
import { Search, Users, File } from "lucide-react";
import type { Message, User, DirectMessage, Channel } from "@db/schema";

// Extend the base message types to include the user
type ExtendedMessage = (Message | DirectMessage) & {
  user: User;
  isRead?: boolean;
};

type Props = {
  channelId: number | null;
  userId: number | null;
};

interface MessagesResponse {
  data: ExtendedMessage[];
  nextCursor: string | null;
  prevCursor: string | null;
}

const MESSAGES_PER_PAGE = 30;

export default function MessageList({ channelId, userId }: Props) {
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const { user: currentUser, token } = useUser();
  const loadingRef = useRef(false);
  const isInitialLoadRef = useRef(true);

  // Query for messages
  const {
    data: messagesData,
    fetchNextPage,
    fetchPreviousPage,
    hasNextPage,
    hasPreviousPage,
    isFetchingNextPage,
    isFetchingPreviousPage,
  } = useInfiniteQuery<MessagesResponse>({
    queryKey: userId ? ["/api/dm", userId] : ["/api/channels", channelId, "messages"],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam = null }) => {
      const url = userId ? `/api/dm/${userId}` : `/api/channels/${channelId}/messages`;
      const params = new URLSearchParams();

      if (pageParam) {
        params.append("cursor", pageParam);
      }
      params.append("limit", MESSAGES_PER_PAGE.toString());

      const response = await fetch(`${url}?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) throw new Error("Failed to fetch messages");
      return response.json();
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    getPreviousPageParam: (firstPage) => firstPage.prevCursor,
    enabled: !!(channelId || userId),
  });

  // Handle scroll events for infinite loading
  const handleScroll = useCallback((event: Event) => {
    const viewport = event.target as HTMLDivElement;
    if (!viewport || loadingRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = viewport;
    const THRESHOLD = 200;

    // Load older messages when near top
    if (scrollTop < THRESHOLD && hasNextPage && !isFetchingNextPage) {
      loadingRef.current = true;
      console.log("[Scroll] Loading older messages...", { scrollTop });

      const prevHeight = scrollHeight;
      fetchNextPage().then(() => {
        requestAnimationFrame(() => {
          if (viewport) {
            const newHeight = viewport.scrollHeight;
            const heightDiff = newHeight - prevHeight;
            viewport.scrollTop = scrollTop + heightDiff;
          }
          loadingRef.current = false;
        });
      });
    }

    // Load newer messages when near bottom
    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
    if (distanceFromBottom < THRESHOLD && hasPreviousPage && !isFetchingPreviousPage) {
      loadingRef.current = true;
      console.log("[Scroll] Loading newer messages...", { distanceFromBottom });

      fetchPreviousPage().then(() => {
        loadingRef.current = false;
      });
    }
  }, [fetchNextPage, fetchPreviousPage, hasNextPage, hasPreviousPage, isFetchingNextPage, isFetchingPreviousPage]);

  // Setup scroll event listener
  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    const debouncedScroll = debounce(handleScroll, 100);
    viewport.addEventListener("scroll", debouncedScroll);

    return () => {
      viewport.removeEventListener("scroll", debouncedScroll);
    };
  }, [handleScroll]);

  // Initial scroll position restoration
  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport || !isInitialLoadRef.current) return;

    const storageKey = channelId ? `scroll-${channelId}` : userId ? `scroll-dm-${userId}` : null;

    if (storageKey) {
      const savedPosition = localStorage.getItem(storageKey);
      if (savedPosition) {
        viewport.scrollTop = parseInt(savedPosition, 10);
      } else {
        viewport.scrollTop = viewport.scrollHeight;
      }
    }

    isInitialLoadRef.current = false;
  }, [channelId, userId, messagesData]);

  // Save scroll position on unmount
  useEffect(() => {
    const storageKey = channelId ? `scroll-${channelId}` : userId ? `scroll-dm-${userId}` : null;
    const viewport = scrollViewportRef.current;

    return () => {
      if (storageKey && viewport) {
        localStorage.setItem(storageKey, viewport.scrollTop.toString());
      }
    };
  }, [channelId, userId]);

  // Query for user/channel information
  const { data: chatPartner } = useQuery<User>({
    queryKey: ["/api/users", userId],
    enabled: !!userId,
  });

  const { data: channel } = useQuery<Channel>({
    queryKey: ["/api/channels", channelId],
    enabled: !!channelId,
  });

  const getMessageTitle = () => {
    if (userId && chatPartner) return chatPartner.username;
    if (channelId && channel) return `#${channel.name}`;
    return "";
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
                <AvatarFallback>{chatPartner.username[0].toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white ${
                chatPartner.status === "online" ? "bg-green-500" : "bg-gray-500"
              }`} />
            </div>
          )}
          <div>
            <h2 className="text-xl font-semibold">{getMessageTitle()}</h2>
          </div>
        </div>
        <div className="flex items-center space-x-4">
          <Search className="w-5 h-5 text-gray-500 cursor-pointer" />
          {!userId && <Users className="w-5 h-5 text-gray-500 cursor-pointer" />}
          <File className="w-5 h-5 text-gray-500 cursor-pointer" />
        </div>
      </div>

      <ScrollArea 
        className="flex-1 p-4"
        onScrollCapture={(e) => handleScroll(e.nativeEvent)}
      >
        {isFetchingNextPage && (
          <div className="text-center py-2 text-muted-foreground">
            Loading older messages...
          </div>
        )}
        <div className="space-y-4">
          {allMessages.map((message, i) => {
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
                data-user-id={message.user.id}
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
          <div className="text-center py-2 text-muted-foreground">
            Loading newer messages...
          </div>
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

// Utility function for scroll event debouncing
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}