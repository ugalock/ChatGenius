import { useEffect, useRef, useCallback, useState } from "react";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { useUser } from "@/hooks/use-user";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { formatDistance } from "date-fns";
import { Search, Users, File } from "lucide-react";
import { ErrorBoundary } from "react-error-boundary";
import type { Message, User, DirectMessage, Channel, MessageRead } from "@db/schema";
import MessageInput from "./MessageInput";

type ExtendedMessage = (Message | DirectMessage) & {
  user: User;
  isRead?: boolean;
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

const MESSAGES_PER_PAGE = 30;

function ErrorFallback({ error }: { error: Error }) {
  return (
    <div className="p-4 text-red-500">
      <p>Something went wrong loading messages:</p>
      <pre className="text-sm">{error.message}</pre>
    </div>
  );
}

export default function MessageList({ channelId, userId }: Props) {
  const [isMounted, setIsMounted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { user: currentUser, token } = useUser();
  const processedMessagesRef = useRef<Set<number>>(new Set());
  const retryTimeoutsRef = useRef<Map<number, NodeJS.Timeout>>(new Map());
  const isInitialLoadRef = useRef(true);
  const loadingMoreRef = useRef(false);
  const scrollToBottomRef = useRef(false);

  useEffect(() => {
    setIsMounted(true);
    return () => {
      setIsMounted(false);
      // Cleanup timeouts
      retryTimeoutsRef.current.forEach(timeout => clearTimeout(timeout));
      retryTimeoutsRef.current.clear();
    };
  }, []);

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
    queryFn: async ({ pageParam = { before: null, after: null } }) => {
      if (!token) throw new Error("No authentication token");

      const url = userId ? `/api/dm/${userId}` : `/api/channels/${channelId}/messages`;
      const queryParams = new URLSearchParams({
        limit: MESSAGES_PER_PAGE.toString(),
        ...(pageParam.before && { before: pageParam.before }),
        ...(pageParam.after && { after: pageParam.after })
      });

      const response = await fetch(`${url}?${queryParams}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch messages: ${response.statusText}`);
      }

      return response.json();
    },
    getNextPageParam: (lastPage) => 
      lastPage.nextCursor ? { before: lastPage.nextCursor, after: null } : undefined,
    getPreviousPageParam: (firstPage) =>
      firstPage.prevCursor ? { before: null, after: firstPage.prevCursor } : undefined,
    initialPageParam: { before: null, after: null } as PageParam,
    enabled: !!(channelId || userId) && !!token,
    retry: 1,
    staleTime: 30000, // Consider data fresh for 30 seconds
  });

  useEffect(() => {
    if (!isMounted) return;

    const scrollContainer = document.getElementById("scroll-container");
    if (!scrollContainer) return;

    const handleScroll = async () => {
      if (loadingMoreRef.current) return;

      try {
        const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
        const distanceFromTop = scrollTop;
        const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
        const threshold = Math.min(clientHeight * 0.3, 300);

        if (distanceFromTop < threshold && hasNextPage && !isFetchingNextPage) {
          loadingMoreRef.current = true;
          const previousHeight = scrollHeight;
          const previousScrollTop = scrollTop;

          await fetchNextPage();

          requestAnimationFrame(() => {
            const heightDiff = scrollContainer.scrollHeight - previousHeight;
            scrollContainer.scrollTop = previousScrollTop + heightDiff;
            loadingMoreRef.current = false;
          });
        }

        if (distanceFromBottom < threshold && hasPreviousPage && !isFetchingPreviousPage) {
          loadingMoreRef.current = true;
          await fetchPreviousPage();
          loadingMoreRef.current = false;

          if (scrollToBottomRef.current) {
            requestAnimationFrame(() => {
              scrollContainer.scrollTop = scrollContainer.scrollHeight;
            });
          }
        }
      } catch (error) {
        console.error("[Scroll] Error during scroll handling:", error);
        loadingMoreRef.current = false;
      }
    };

    const debouncedScroll = debounce(handleScroll, 150);
    scrollContainer.addEventListener("scroll", debouncedScroll);

    return () => {
      scrollContainer.removeEventListener("scroll", debouncedScroll);
    };
  }, [
    isMounted,
    fetchNextPage,
    fetchPreviousPage,
    hasNextPage,
    hasPreviousPage,
    isFetchingNextPage,
    isFetchingPreviousPage,
  ]);

  useEffect(() => {
    if (!isMounted || !messagesData?.pages.length) return;

    const scrollContainer = document.getElementById("scroll-container");
    if (!scrollContainer) return;

    const storageKey = channelId 
      ? `chat-scroll-position-channel-${channelId}` 
      : `chat-scroll-position-user-${userId}`;

    try {
      const savedPosition = localStorage.getItem(storageKey);

      if (savedPosition && isInitialLoadRef.current) {
        isInitialLoadRef.current = false;
        requestAnimationFrame(() => {
          scrollContainer.scrollTop = parseInt(savedPosition);
        });
      } else if (!savedPosition) {
        scrollToBottomRef.current = true;
        requestAnimationFrame(() => {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        });
      }

      const savePosition = () => {
        try {
          const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
          if (scrollHeight - (scrollTop + clientHeight) > 100) {
            localStorage.setItem(storageKey, scrollTop.toString());
          } else {
            localStorage.removeItem(storageKey);
          }
        } catch (error) {
          console.error("[Scroll] Error saving position:", error);
        }
      };

      window.addEventListener('beforeunload', savePosition);
      return () => {
        savePosition();
        window.removeEventListener('beforeunload', savePosition);
      };
    } catch (error) {
      console.error("[Scroll] Error managing scroll position:", error);
    }
  }, [isMounted, channelId, userId, messagesData]);

  // Message visibility tracking with error boundaries
  useEffect(() => {
    if (!isMounted || !channelId || !currentUser?.id) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;

          const messageId = parseInt(entry.target.getAttribute("data-message-id") || "0");
          const userId = parseInt(entry.target.getAttribute("data-user-id") || "0");

          if (messageId && userId !== currentUser.id) {
            try {
              updateMessageReadStatus(messageId);
            } catch (error) {
              console.error("[Message Tracking] Failed to update read status:", error);
            }
          }
        });
      },
      {
        root: document.getElementById("scroll-container"),
        threshold: 0.5,
        rootMargin: "50px 0px",
      }
    );

    const messageElements = document.querySelectorAll("[data-message-id]");
    messageElements.forEach((element) => {
      if (element instanceof Element) {
        observer.observe(element);
      }
    });

    return () => observer.disconnect();
  }, [isMounted, channelId, currentUser?.id, messagesData]);

  const updateMessageReadStatus = useCallback(async (messageId: number) => {
    if (!messageId || !isMounted || processedMessagesRef.current.has(messageId)) return;

    try {
      const response = await fetch(`/api/messages/${messageId}/read`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      processedMessagesRef.current.add(messageId);
    } catch (error) {
      console.error("[MessageTracking] Error:", error);
      // Retry after 1 second
      const retryTimeout = setTimeout(() => {
        processedMessagesRef.current.delete(messageId);
        updateMessageReadStatus(messageId);
      }, 1000);
      retryTimeoutsRef.current.set(messageId, retryTimeout);
    }
  }, [token, isMounted]);

  if (!channelId && !userId) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Select a channel or user to start chatting
      </div>
    );
  }

  const allMessages = messagesData?.pages.flatMap((page) => page.data) || [];

  return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <div className="h-full flex flex-col">
        <div className="bg-white border-b p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Chat header content */}
            <div>
              <h2 className="text-xl font-semibold">
                {userId ? chatPartner?.username : channel?.name && `#${channel.name}`}
              </h2>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <Search className="w-5 h-5 text-gray-500 cursor-pointer" />
            {!userId && <Users className="w-5 h-5 text-gray-500 cursor-pointer" />}
            <File className="w-5 h-5 text-gray-500 cursor-pointer" />
          </div>
        </div>

        <ScrollArea id="scroll-container" ref={scrollRef} className="flex-1 p-4">
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
    </ErrorBoundary>
  );
}

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