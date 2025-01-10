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

const MESSAGES_PER_PAGE = 1000;

export default function MessageList({ channelId, userId }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollableElementRef = useRef<HTMLDivElement | null>(null);
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
    queryKey: ["/api/channels", channelId, "read-messages"],
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

  // Query for read direct messages to initialize the processed set
  const { data: readDMs } = useQuery<DirectMessage[]>({
    queryKey: ["/api/users", userId, "read-direct-messages"],
    queryFn: async () => {
      if (!userId) return [];
      const response = await fetch(`/api/users/${userId}/read-direct-messages`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error("Failed to fetch read messages");
      return response.json();
    },
    enabled: !!userId,
  });

  // Initialize processedMessagesRef with already read messages
  useEffect(() => {
    if (readMessages) {
      readMessages.forEach((read) => {
        processedMessagesRef.current.add(read.messageId);
      });
    } else if (readDMs) {
      readDMs.forEach((read) => {
        processedMessagesRef.current.add(read.id);
      });
    }
  }, [readMessages, readDMs]);

  // Query for messages with infinite loading
  const {
    data: messagesData,
    fetchNextPage,
    fetchPreviousPage,
    hasNextPage,
    hasPreviousPage,
    isFetchingNextPage,
    isFetchingPreviousPage,
  } = useInfiniteQuery<MessagesResponse>({
    queryKey: userId
      ? ["/api/dm", userId]
      : ["/api/channels", channelId, "messages"],
    queryFn: async ({ pageParam = { before: null, after: null } }) => {
      const url = userId
        ? `/api/dm/${userId}`
        : `/api/channels/${channelId}/messages`;

      const queryParams = new URLSearchParams();
      const typedPageParam = pageParam as PageParam;

      if (typedPageParam.before) {
        queryParams.append("before", typedPageParam.before);
      }
      if (typedPageParam.after) {
        queryParams.append("after", typedPageParam.after);
      }
      queryParams.append("limit", MESSAGES_PER_PAGE.toString());

      const response = await fetch(`${url}?${queryParams}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error("Failed to fetch messages");
      return response.json();
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.data || lastPage.data.length < MESSAGES_PER_PAGE)
        return undefined;
      return {
        before: lastPage.data[0].id.toString(),
        after: null,
      } as PageParam;
    },
    getPreviousPageParam: (firstPage) => {
      if (!firstPage.data || firstPage.data.length < MESSAGES_PER_PAGE)
        return undefined;
      return {
        before: null,
        after: firstPage.data[firstPage.data.length - 1].id.toString(),
      } as PageParam;
    },
    initialPageParam: { before: null, after: null } as PageParam,
    enabled: !!(channelId || userId),
  });

  // Update the effect that initializes the scrollable element reference
  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) return;

    // Find and store the scrollable element
    const scrollableElement = scrollContainer.querySelector(
      "[data-radix-scroll-area-viewport]",
    );
    if (!scrollableElement) {
      console.log("Could not find scrollable element");
      return;
    }
    scrollableElementRef.current = scrollableElement as HTMLDivElement;
  }, [scrollRef.current]); // Only run when scrollRef.current changes

  // Enhanced infinite scroll with better load triggers and position restoration
  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) return;

    const scrollableElement = scrollableElementRef.current;
    if (!scrollableElement) return;
    // Create debounced function for saving scroll position
    const debouncedSavePosition = debounce((position: number) => {
      const storageKey = channelId
        ? `chat-scroll-position-channel-${channelId}`
        : userId
          ? `chat-scroll-position-user-${userId}`
          : "";

      if (storageKey) {
        const maxScroll =
          scrollableElement.scrollHeight - scrollableElement.clientHeight;
        // Only save if we're not at the bottom
        console.log(maxScroll, position);
        if (maxScroll - position > 100) {
          localStorage.setItem(storageKey, position.toString());
          console.log(`[Scroll] Saved position ${position} for ${storageKey}`);
        } else {
          localStorage.removeItem(storageKey);
          console.log(`[Scroll] Cleared saved position for ${storageKey}`);
        }
      }
    }, 1000); // Save position every 1 second

    // Load older messages when scrolling up
    const handleScroll = async () => {
      if (loadingMoreRef.current) return;

      const { scrollTop, scrollHeight, clientHeight } = scrollableElement;
      const distanceFromTop = scrollTop;
      const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);

      // Save scroll position
      debouncedSavePosition(scrollTop);

      // Load older messages when near the top
      if (distanceFromTop < 200 && hasNextPage && !isFetchingNextPage) {
        loadingMoreRef.current = true;
        console.log("[Scroll] Loading older messages...");

        // Save current scroll position and heights
        const previousHeight = scrollHeight;
        const previousScrollTop = scrollTop;

        try {
          await fetchNextPage();

          // Restore scroll position after new content is loaded
          setTimeout(() => {
            requestAnimationFrame(() => {
              if (scrollContainer) {
                const newHeight = scrollableElement.scrollHeight;
                const heightDifference = newHeight - previousHeight;
                scrollableElement.scrollTop =
                  previousScrollTop + heightDifference;
              }
              loadingMoreRef.current = false;
            });
          }, 0);
        } catch (error) {
          console.error("[Scroll] Error loading older messages:", error);
          loadingMoreRef.current = false;
        }
      }

      // Load newer messages when near the bottom
      if (
        distanceFromBottom < 200 &&
        hasPreviousPage &&
        !isFetchingPreviousPage
      ) {
        loadingMoreRef.current = true;
        console.log("[Scroll] Loading newer messages...");

        try {
          await fetchPreviousPage();
          loadingMoreRef.current = false;
        } catch (error) {
          console.error("[Scroll] Error loading newer messages:", error);
          loadingMoreRef.current = false;
        }
      }
    };

    const debouncedScroll = debounce(handleScroll, 150);
    scrollableElement.addEventListener("scroll", debouncedScroll);
    return () => {
      scrollableElement.removeEventListener("scroll", debouncedScroll);
      if (scrollRestorationTimeoutRef.current) {
        clearTimeout(scrollRestorationTimeoutRef.current);
      }
    };
  }, [
    fetchNextPage,
    fetchPreviousPage,
    hasNextPage,
    hasPreviousPage,
    isFetchingNextPage,
    isFetchingPreviousPage,
    channelId,
    userId,
  ]);

  // Enhanced scroll position restoration
  useEffect(() => {
    if (!scrollRef.current) return;

    const scrollableElement = scrollableElementRef.current;
    if (!scrollableElement) return;
    const storageKey = channelId
      ? `chat-scroll-position-channel-${channelId}`
      : userId
        ? `chat-scroll-position-user-${userId}`
        : "";
    const savedPosition = localStorage.getItem(storageKey);

    if (savedPosition && isInitialLoadRef.current) {
      isInitialLoadRef.current = false;

      // Use a more robust approach to restore scroll position
      const restorePosition = () => {
        const targetPosition = parseInt(savedPosition);
        scrollableElement.scrollTop = targetPosition;

        // Verify scroll position was set correctly
        if (Math.abs(scrollableElement.scrollTop - targetPosition) > 10) {
          // If position wasn't set correctly, try again
          scrollRestorationTimeoutRef.current = setTimeout(restorePosition, 50);
        } else {
          console.log(
            `[Scroll] Successfully restored position ${targetPosition}`,
          );
        }
      };

      // Initial attempt to restore scroll position
      scrollRestorationTimeoutRef.current = setTimeout(restorePosition, 100);
    } else if (!savedPosition) {
      // If no saved position, scroll to bottom on initial load
      const scrollToBottom = () => {
        if (scrollableElement) {
          scrollableElement.scrollTop = scrollableElement.scrollHeight;
        }
      };
      scrollRestorationTimeoutRef.current = setTimeout(scrollToBottom, 100);
    }

    return () => {
      if (scrollRestorationTimeoutRef.current) {
        clearTimeout(scrollRestorationTimeoutRef.current);
      }
    };
  }, [channelId, userId, messagesData]);

  // Enhanced updateLastRead function with retry mechanism and duplicate prevention
  const updateLastRead = useCallback(
    async (messageId: number, cid: number | null, uid: number | null) => {
      if (!messageId || processedMessagesRef.current.has(messageId) || !(cid || uid)) return;

      try {
        console.log(`[MessageTracking] Marking message ${messageId} as read`);
        const response = await fetch(`/api/messages/${messageId}/read`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            channelId: cid,
            userId: uid,
          }),
          credentials: "include",
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
            updateLastRead(messageId, cid, uid);
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
    if (!(channelId || userId)) return;

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
        const uid = parseInt(entry.target.getAttribute("data-user-id") || "0");

        // Skip messages from the current user
        if (uid === currentUser?.id) {
          return;
        }

        // Mark as read if message is at least 50% visible
        if (entry.intersectionRatio >= 0.5 && messageId) {
          // console.log(
          //   `[MessageTracking] Message ${messageId} is ${entry.intersectionRatio * 100}% visible`,
          // );

          // Clear any existing timeout
          if (debounceTimeoutRef.current) {
            clearTimeout(debounceTimeoutRef.current);
          }

          // Reduced debounce time for better responsiveness
          debounceTimeoutRef.current = setTimeout(() => {
            updateLastRead(messageId, channelId, userId);
          }, 100);
        }
      });
    };

    console.log(
      `[MessageTracking] Setting up intersection observer for channel: ${channelId} or user: ${userId}`,
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
  }, [channelId, updateLastRead, userId]);

  // Improved scroll position persistence
  useEffect(() => {
    if (!(channelId || userId)) return;
    const storageKey = channelId
      ? `chat-scroll-position-channel-${channelId}`
      : userId
        ? `chat-scroll-position-user-${userId}`
        : "";

    // Save position when unmounting or changing channels
    return () => {
      if (scrollableElementRef.current) {
        const position = scrollableElementRef.current.scrollTop;
        const maxScroll =
          scrollableElementRef.current.scrollHeight -
          scrollableElementRef.current.clientHeight;

        // Only save if we're not at the bottom
        if (maxScroll - position > 100) {
          localStorage.setItem(storageKey, position.toString());
          console.log(`[Scroll] Saved position ${position} for ${storageKey}`);
        } else {
          localStorage.removeItem(storageKey);
          console.log(`[Scroll] Cleared saved position for ${storageKey}`);
        }
      }
    };
  }, [channelId, userId, updateLastRead]);

  // Ensure new messages are observed when they're added
  useEffect(() => {
    if (!observerRef.current) return;

    // Wait for a brief moment to ensure DOM is updated
    setTimeout(() => {
      const messageElements = document.querySelectorAll("[data-message-id]");
      console.log(
        `[MessageTracking] Observing ${messageElements.length} messages`,
      );
      messageElements.forEach((element) => {
        if (element instanceof Element) {
          observerRef.current?.observe(element);
        }
      });

      // Check for initially visible messages
      const observer = observerRef.current;
      if (observer) {
        messageElements.forEach((element) => {
          if (element instanceof Element) {
            const messageId = parseInt(
              element.getAttribute("data-message-id") || "0",
            );
            const uid = parseInt(
              element.getAttribute("data-user-id") || "0",
            );

            // Skip if already processed or from current user
            if (
              processedMessagesRef.current.has(messageId) ||
              uid === currentUser?.id
            ) {
              return;
            }

            // Force an initial intersection check
            observer.unobserve(element);
            observer.observe(element);
          }
        });
      }
    }, 100);
  }, [messagesData, channelId, currentUser?.id]);

  // Save scroll position when leaving channel
  useEffect(() => {
    const storageKey = channelId
      ? `chat-scroll-position-channel-${channelId}`
      : userId
        ? `chat-scroll-position-user-${userId}`
        : "";
    if (!storageKey) {
      return;
    }

    // Save position when unmounting
    return () => {
      if (scrollableElementRef.current) {
        const position = scrollableElementRef.current.scrollTop;
        localStorage.setItem(storageKey, position.toString());
      }
    };
  }, [channelId, userId]);

  // Restore scroll position when mounting
  useEffect(() => {
    const storageKey = channelId
      ? `chat-scroll-position-channel-${channelId}`
      : userId
        ? `chat-scroll-position-user-${userId}`
        : "";
    const savedPosition = localStorage.getItem(storageKey);

    if (scrollableElementRef.current && savedPosition) {
      // Use setTimeout to ensure content is loaded
      setTimeout(() => {
        if (scrollableElementRef.current) {
          scrollableElementRef.current.scrollTop = parseInt(savedPosition);
        }
      }, 100);
    }
  }, [channelId, userId]);

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
