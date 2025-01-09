import { useEffect, useRef, useCallback } from "react";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { useUser } from "@/hooks/use-user";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { formatDistance } from "date-fns";
import { Search, Users, File } from "lucide-react";
import type {
  Message,
  User,
  DirectMessage,
  Channel,
  MessageRead,
} from "@db/schema";
import MessageInput from "./MessageInput";

// Extend the base message types to include the user
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

const SCROLL_THRESHOLD = 300; // Reduced threshold for better responsiveness
const MESSAGES_PER_PAGE = 30;

export default function MessageList({ channelId, userId }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastReadRef = useRef<number | null>(null);
  const { user: currentUser, token } = useUser();
  const observerRef = useRef<IntersectionObserver | null>(null);
  const debounceTimeoutRef = useRef<NodeJS.Timeout>();
  const processedMessagesRef = useRef<Set<number>>(new Set());
  const retryTimeoutsRef = useRef<Map<number, NodeJS.Timeout>>(new Map());
  const scrollRestorationTimeoutRef = useRef<NodeJS.Timeout>();
  const isInitialLoadRef = useRef(true);
  const loadingMoreRef = useRef(false);

  // Query for read messages to initialize the processed set
  const { data: readMessages } = useQuery<MessageRead[]>({
    queryKey: ["/api/messages/read", channelId],
    queryFn: async () => {
      if (!channelId) return [];
      const response = await fetch(`/api/channels/${channelId}/read-messages`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error("Failed to fetch read messages");
      return response.json();
    },
    enabled: !!channelId,
  });

  // Initialize processedMessagesRef with already read messages
  useEffect(() => {
    if (readMessages) {
      readMessages.forEach((read) => {
        processedMessagesRef.current.add(read.messageId);
      });
    }
  }, [readMessages]);

  // Query for messages with infinite loading
  const {
    data: messagesData,
    fetchNextPage,
    fetchPreviousPage,
    hasNextPage,
    hasPreviousPage,
    isFetchingNextPage,
    isFetchingPreviousPage,
    isLoading,
  } = useInfiniteQuery<MessagesResponse>({
    queryKey: userId
      ? ["/api/dm", userId]
      : ["/api/channels", channelId, "messages"],
    queryFn: async ({ pageParam = { before: null, after: null } as PageParam }) => {
      console.log("[Query] Fetching messages with params:", pageParam);
      const url = userId
        ? `/api/dm/${userId}`
        : `/api/channels/${channelId}/messages`;

      const queryParams = new URLSearchParams();
      if (pageParam.before) {
        queryParams.append("before", pageParam.before);
      }
      if (pageParam.after) {
        queryParams.append("after", pageParam.after);
      }
      queryParams.append("limit", MESSAGES_PER_PAGE.toString());

      const response = await fetch(`${url}?${queryParams}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[Query] Failed to fetch messages:", errorText);
        throw new Error(errorText);
      }

      const data = await response.json();
      console.log("[Query] Fetched messages:", data);
      return data;
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.data?.length || lastPage.data.length < MESSAGES_PER_PAGE) {
        console.log("[Pagination] No more older messages");
        return undefined;
      }
      return {
        before: lastPage.data[lastPage.data.length - 1].id.toString(),
        after: null,
      } as PageParam;
    },
    getPreviousPageParam: (firstPage) => {
      if (!firstPage.data?.length || firstPage.data.length < MESSAGES_PER_PAGE) {
        console.log("[Pagination] No more newer messages");
        return undefined;
      }
      return {
        before: null,
        after: firstPage.data[0].id.toString(),
      } as PageParam;
    },
    initialPageParam: { before: null, after: null } as PageParam,
    enabled: !!(channelId || userId),
  });

  // Optimized scroll handling with better position restoration
  useEffect(() => {
    const scrollContainer = document.getElementById("scroll-container");
    if (!scrollContainer) return;

    let scrollTimeout: NodeJS.Timeout;
    const handleScroll = () => {
      if (loadingMoreRef.current) return;

      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
      const distanceFromTop = scrollTop;
      const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);

      // Load older messages when near top
      if (distanceFromTop < SCROLL_THRESHOLD && hasNextPage && !isFetchingNextPage) {
        loadingMoreRef.current = true;
        const previousHeight = scrollHeight;
        const previousScrollTop = scrollTop;

        fetchNextPage()
          .then(() => {
            // Restore scroll position after loading older messages
            requestAnimationFrame(() => {
              if (scrollContainer) {
                const heightDifference = scrollContainer.scrollHeight - previousHeight;
                scrollContainer.scrollTop = previousScrollTop + heightDifference;
              }
            });
          })
          .catch((error) => {
            console.error("[Scroll] Error loading older messages:", error);
          })
          .finally(() => {
            loadingMoreRef.current = false;
          });
      }

      // Load newer messages when near bottom
      if (distanceFromBottom < SCROLL_THRESHOLD && hasPreviousPage && !isFetchingPreviousPage) {
        loadingMoreRef.current = true;

        fetchPreviousPage()
          .catch((error) => {
            console.error("[Scroll] Error loading newer messages:", error);
          })
          .finally(() => {
            loadingMoreRef.current = false;
          });
      }
    };

    const debouncedScroll = debounce(handleScroll, 100);
    scrollContainer.addEventListener("scroll", debouncedScroll);

    return () => {
      scrollContainer.removeEventListener("scroll", debouncedScroll);
      clearTimeout(scrollTimeout);
    };
  }, [
    fetchNextPage,
    fetchPreviousPage,
    hasNextPage,
    hasPreviousPage,
    isFetchingNextPage,
    isFetchingPreviousPage,
  ]);

  // Consolidated scroll position restoration
  useEffect(() => {
    if (!(channelId || userId)) return;

    const storageKey = channelId
      ? `chat-scroll-position-channel-${channelId}`
      : `chat-scroll-position-user-${userId}`;

    const savedPosition = localStorage.getItem(storageKey);
    const scrollContainer = document.getElementById("scroll-container");

    if (scrollContainer && isInitialLoadRef.current) {
      isInitialLoadRef.current = false;

      const restorePosition = () => {
        if (!scrollContainer) return;

        if (savedPosition) {
          const targetPosition = parseInt(savedPosition);
          scrollContainer.scrollTop = targetPosition;
          console.log(`[Scroll] Restored to position ${targetPosition}`);
        } else {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
          console.log("[Scroll] Scrolled to bottom (no saved position)");
        }
      };

      // Wait for content to be rendered
      scrollRestorationTimeoutRef.current = setTimeout(restorePosition, 100);
    }

    // Save position on cleanup
    return () => {
      if (scrollContainer && !isInitialLoadRef.current) {
        const position = scrollContainer.scrollTop;
        const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;

        if (maxScroll - position > 100) {
          localStorage.setItem(storageKey, position.toString());
          console.log(`[Scroll] Saved position ${position}`);
        } else {
          localStorage.removeItem(storageKey);
          console.log("[Scroll] Cleared saved position (at bottom)");
        }
      }
    };
  }, [channelId, userId, messagesData]);

  // Enhanced updateLastRead function with retry mechanism and duplicate prevention
  const updateLastRead = useCallback(
    async (messageId: number) => {
      if (!messageId || processedMessagesRef.current.has(messageId)) return;

      try {
        console.log(`[MessageTracking] Marking message ${messageId} as read`);
        const response = await fetch(`/api/messages/${messageId}/read`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(
            "[MessageTracking] Failed to mark message as read:",
            errorText,
          );

          // Clear any existing retry timeout for this message
          if (retryTimeoutsRef.current.has(messageId)) {
            clearTimeout(retryTimeoutsRef.current.get(messageId));
            retryTimeoutsRef.current.delete(messageId);
          }

          // Set up retry with exponential backoff
          const retryTimeout = setTimeout(() => {
            console.log(
              `[MessageTracking] Retrying to mark message ${messageId} as read`,
            );
            processedMessagesRef.current.delete(messageId); // Allow retry
            updateLastRead(messageId);
          }, 1000);

          retryTimeoutsRef.current.set(messageId, retryTimeout);
        } else {
          console.log(
            `[MessageTracking] Successfully marked message ${messageId} as read`,
          );
          processedMessagesRef.current.add(messageId);

          // Clear retry timeout if exists
          if (retryTimeoutsRef.current.has(messageId)) {
            clearTimeout(retryTimeoutsRef.current.get(messageId));
            retryTimeoutsRef.current.delete(messageId);
          }
        }
      } catch (error) {
        console.error(
          "[MessageTracking] Error marking message as read:",
          error,
        );
        // Reset processed state to allow retry
        processedMessagesRef.current.delete(messageId);
      }
    },
    [token],
  );

  // Enhanced intersection observer setup with better visibility tracking
  useEffect(() => {
    if (!channelId) return;

    const options: IntersectionObserverInit = {
      root: document.getElementById("scroll-container"),
      // Using multiple thresholds for more granular visibility detection
      threshold: [0.1, 0.3, 0.5, 0.7],
      // Add margin to start observing before elements are fully in view
      rootMargin: "50px 0px",
    };

    const handleIntersection = (entries: IntersectionObserverEntry[]) => {
      entries.forEach((entry) => {
        const messageId = parseInt(
          entry.target.getAttribute("data-message-id") || "0",
        );
        const uid = parseInt(
          entry.target.getAttribute("data-user-id") || "0",
        );

        // Skip messages from the current user
        if (uid === userId) {
          return;
        }

        // Mark as read if message is at least 30% visible
        if (entry.intersectionRatio >= 0.3 && messageId && channelId) {
          console.log(
            `[MessageTracking] Message ${messageId} is ${entry.intersectionRatio * 100}% visible`,
          );

          // Clear any existing timeout
          if (debounceTimeoutRef.current) {
            clearTimeout(debounceTimeoutRef.current);
          }

          // Reduced debounce time for better responsiveness
          debounceTimeoutRef.current = setTimeout(() => {
            updateLastRead(messageId);
          }, 100);
        }
      });
    };

    console.log(
      "[MessageTracking] Setting up intersection observer for channel:",
      channelId,
    );
    const observer = new IntersectionObserver(handleIntersection, options);
    observerRef.current = observer;

    // Enhanced cleanup function
    return () => {
      console.log("[MessageTracking] Cleaning up intersection observer");
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      // Clear all retry timeouts
      retryTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
      retryTimeoutsRef.current.clear();
      observer.disconnect();
      observerRef.current = null;
      // Reset processed messages when changing channels
      processedMessagesRef.current.clear();
    };
  }, [channelId, updateLastRead, currentUser?.id]);


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
          <div className="text-center py-2 text-muted-foreground">
            Loading older messages...
          </div>
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
                          { addSuffix: true },
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
  wait: number,
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