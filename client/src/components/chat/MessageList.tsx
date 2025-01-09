import { useEffect, useRef, useCallback } from "react";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { useUser } from "@/hooks/use-user";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { formatDistance } from "date-fns";
import { Search, Users, File } from "lucide-react";
import type { Message, User, DirectMessage, Channel, MessageRead } from "@db/schema";
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

const MESSAGES_PER_PAGE = 50;

export default function MessageList({ channelId, userId }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastReadRef = useRef<number | null>(null);
  const { user: currentUser, token } = useUser();
  const observerRef = useRef<IntersectionObserver | null>(null);
  const debounceTimeoutRef = useRef<NodeJS.Timeout>();
  const processedMessagesRef = useRef<Set<number>>(new Set());
  const retryTimeoutsRef = useRef<Map<number, NodeJS.Timeout>>(new Map());

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
  } = useInfiniteQuery<MessagesResponse>({
    queryKey: userId ? ["/api/dm", userId] : ["/api/channels", channelId, "messages"],
    queryFn: async ({ pageParam = { before: null, after: null } }) => {
      const url = userId
        ? `/api/dm/${userId}`
        : `/api/channels/${channelId}/messages`;

      const queryParams = new URLSearchParams();

      const typedPageParam = pageParam as PageParam;
      if (typedPageParam.before) {
        queryParams.append('before', typedPageParam.before);
      }
      if (typedPageParam.after) {
        queryParams.append('after', typedPageParam.after);
      }
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
      return { before: lastPage.data[lastPage.data.length - 1].id.toString(), after: null } as PageParam;
    },
    getPreviousPageParam: (firstPage) => {
      if (!firstPage.data || firstPage.data.length < MESSAGES_PER_PAGE) return undefined;
      return { before: null, after: firstPage.data[0].id.toString() } as PageParam;
    },
    initialPageParam: { before: null, after: null } as PageParam,
    enabled: !!(channelId || userId),
  });

  // Handle infinite scroll with proper loading states
  useEffect(() => {
    const scrollContainer = document.getElementById('scroll-container');
    if (!scrollContainer) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;

      // Load older messages when scrolling up near the top
      if (scrollTop < 100 && hasNextPage && !isFetchingNextPage) {
        console.log('[Scroll] Loading older messages...');
        // Save current scroll position
        const currentHeight = scrollHeight - clientHeight;

        fetchNextPage().then(() => {
          // Restore scroll position after loading
          if (scrollContainer) {
            const newHeight = scrollContainer.scrollHeight - scrollContainer.clientHeight;
            scrollContainer.scrollTop = newHeight - currentHeight + scrollTop;
          }
        });
      }

      // Load newer messages when scrolling down near the bottom
      if (scrollHeight - (scrollTop + clientHeight) < 100 && hasPreviousPage && !isFetchingPreviousPage) {
        console.log('[Scroll] Loading newer messages...');
        fetchPreviousPage();
      }
    };

    scrollContainer.addEventListener('scroll', handleScroll);
    return () => scrollContainer.removeEventListener('scroll', handleScroll);
  }, [fetchNextPage, fetchPreviousPage, hasNextPage, hasPreviousPage, isFetchingNextPage, isFetchingPreviousPage]);

  // Enhanced updateLastRead function with retry mechanism and duplicate prevention
  const updateLastRead = useCallback(async (messageId: number) => {
    if (!messageId || processedMessagesRef.current.has(messageId)) return;

    try {
      console.log(`[MessageTracking] Marking message ${messageId} as read`);
      const response = await fetch(`/api/messages/${messageId}/read`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[MessageTracking] Failed to mark message as read:', errorText);

        // Clear any existing retry timeout for this message
        if (retryTimeoutsRef.current.has(messageId)) {
          clearTimeout(retryTimeoutsRef.current.get(messageId));
          retryTimeoutsRef.current.delete(messageId);
        }

        // Set up retry with exponential backoff
        const retryTimeout = setTimeout(() => {
          console.log(`[MessageTracking] Retrying to mark message ${messageId} as read`);
          processedMessagesRef.current.delete(messageId); // Allow retry
          updateLastRead(messageId);
        }, 1000);

        retryTimeoutsRef.current.set(messageId, retryTimeout);
      } else {
        console.log(`[MessageTracking] Successfully marked message ${messageId} as read`);
        processedMessagesRef.current.add(messageId);

        // Clear retry timeout if exists
        if (retryTimeoutsRef.current.has(messageId)) {
          clearTimeout(retryTimeoutsRef.current.get(messageId));
          retryTimeoutsRef.current.delete(messageId);
        }
      }
    } catch (error) {
      console.error('[MessageTracking] Error marking message as read:', error);
      // Reset processed state to allow retry
      processedMessagesRef.current.delete(messageId);
    }
  }, [token]);

  // Enhanced intersection observer setup with better visibility tracking
  useEffect(() => {
    if (!channelId) return;

    const options: IntersectionObserverInit = {
      root: document.getElementById('scroll-container'),
      // Using multiple thresholds for more granular visibility detection
      threshold: [0.1, 0.3, 0.5, 0.7],
      // Add margin to start observing before elements are fully in view
      rootMargin: '50px 0px',
    };

    const handleIntersection = (entries: IntersectionObserverEntry[]) => {
      entries.forEach((entry) => {
        const messageId = parseInt(entry.target.getAttribute('data-message-id') || '0');
        const userId = parseInt(entry.target.getAttribute('data-user-id') || '0');

        // Skip messages from the current user
        if (userId === currentUser?.id) {
          return;
        }

        // Mark as read if message is at least 30% visible
        if (entry.intersectionRatio >= 0.3 && messageId && channelId) {
          console.log(`[MessageTracking] Message ${messageId} is ${entry.intersectionRatio * 100}% visible`);

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

    console.log('[MessageTracking] Setting up intersection observer for channel:', channelId);
    const observer = new IntersectionObserver(handleIntersection, options);
    observerRef.current = observer;

    // Enhanced cleanup function
    return () => {
      console.log('[MessageTracking] Cleaning up intersection observer');
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

  // Ensure new messages are observed when they're added
  useEffect(() => {
    if (!observerRef.current || !channelId) return;

    // Wait for a brief moment to ensure DOM is updated
    setTimeout(() => {
      const messageElements = document.querySelectorAll('[data-message-id]');
      console.log(`[MessageTracking] Observing ${messageElements.length} messages`);
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
            const messageId = parseInt(element.getAttribute('data-message-id') || '0');
            const userId = parseInt(element.getAttribute('data-user-id') || '0');

            // Skip if already processed or from current user
            if (processedMessagesRef.current.has(messageId) || userId === currentUser?.id) {
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
    const storageKey = `chat-scroll-position-${channelId || userId}`;

    // Save position when unmounting
    return () => {
      if (scrollRef.current) {
        const position = scrollRef.current.scrollTop;
        localStorage.setItem(storageKey, position.toString());
      }
    };
  }, [channelId, userId]);

  // Restore scroll position when mounting
  useEffect(() => {
    const storageKey = `chat-scroll-position-${channelId || userId}`;
    const savedPosition = localStorage.getItem(storageKey);

    if (scrollRef.current && savedPosition) {
      // Use setTimeout to ensure content is loaded
      setTimeout(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = parseInt(savedPosition);
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