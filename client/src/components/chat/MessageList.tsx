import { useEffect, useRef, useCallback, useState } from "react";
import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useUser } from "@/hooks/use-user";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  format,
  formatDistance,
  isToday,
  isYesterday,
  isSameDay,
} from "date-fns";
import { Search, Users, File, ArrowLeft, MessageSquare } from "lucide-react";
import type {
  Message,
  User,
  DirectMessage,
  Channel,
  MessageRead,
} from "@db/schema";
import MessageInput from "./MessageInput";
import { SearchBar } from "./SearchBar";
import { SearchResult, SearchResults } from "./SearchResults";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  MessageSquare as MessageSquareIcon,
  Smile,
  MoreHorizontal,
} from "lucide-react";
import EmojiPicker, { EmojiClickData } from "emoji-picker-react";
import { File as FileIcon, Download } from "lucide-react";
import type { Attachment } from "@db/schema";
import {
  Image as ImageIcon,
  FileText,
  Film,
  Music,
  Archive,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";

// Update type definition for message reactions and thread support
interface MessageReaction {
  emoji: string;
  userIds: number[];
}

interface MessageReactions {
  [key: string]: number[];
}

type BaseMessage = {
  id: number;
  content: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  threadId: number | null;
  user: User;
  isRead?: boolean;
  reactions?: MessageReactions;
  replyCount?: number;
  attachments?: Attachment[];
};

type ChannelMessage = BaseMessage & {
  userId: number;
  channelId: number | null;
};

type DirectMessageType = BaseMessage & {
  fromUserId: number;
  toUserId: number;
};

type ExtendedMessage = ChannelMessage | DirectMessageType;

interface MessageActionsProps {
  message: ExtendedMessage;
  replyCallback: (threadId: number | null | undefined) => void;
  isEditing: boolean;
  setIsEditing: (value: boolean) => void;
  editContent: string;
  setEditContent: (value: string) => void;
  handleSaveEdit: () => void;
}

const MessageActions = ({
  message,
  replyCallback,
  isEditing,
  setIsEditing,
  editContent,
  setEditContent,
  handleSaveEdit,
}: MessageActionsProps) => {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const { user: currentUser, token } = useUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const isOwner = currentUser?.id === message.user.id;

  const addReactionMutation = useMutation({
    mutationFn: async (emoji: string) => {
      const response = await fetch(`/api/messages/${message.id}/react`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          emoji,
          isDirectMessage: "toUserId" in message,
          toUserId: "toUserId" in message ? message.toUserId : undefined,
          fromUserId: "fromUserId" in message ? message.fromUserId : undefined,
        }),
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to add reaction");
      }

      return response.json();
    },
    onSuccess: () => {
      if ("channelId" in message && message.channelId) {
        queryClient.invalidateQueries({
          queryKey: [
            "/api/channels",
            message.channelId,
            "messages",
            message.threadId || undefined,
          ],
        });
      } else if ("toUserId" in message) {
        queryClient.invalidateQueries({
          queryKey: [
            "/api/dm",
            message.toUserId,
            message.threadId || undefined,
          ],
        });
      }
    },
  });

  const deleteMessageMutation = useMutation({
    mutationFn: async () => {
      const url = "toUserId" in message
        ? `/api/dm/${message.id}`
        : `/api/messages/${message.id}`;

      const response = await fetch(url, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          isDirectMessage: "toUserId" in message,
          toUserId: "toUserId" in message ? message.toUserId : undefined,
          fromUserId: "fromUserId" in message ? message.fromUserId : undefined,
        }),
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },
    onSuccess: () => {
      if ("channelId" in message && message.channelId) {
        queryClient.invalidateQueries({
          queryKey: [
            "/api/channels",
            message.channelId,
            "messages",
            message.threadId || undefined,
          ],
        });
      } else if ("toUserId" in message) {
        queryClient.invalidateQueries({
          queryKey: [
            "/api/dm",
            message.toUserId,
            message.threadId || undefined,
          ],
        });
      }
      toast({
        title: "Success",
        description: "Message deleted successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete message",
        variant: "destructive",
      });
    },
  });

  const handleEmojiSelect = (emojiData: EmojiClickData) => {
    addReactionMutation.mutate(emojiData.emoji);
    setShowEmojiPicker(false);
  };

  return (
    <div className="opacity-0 group-hover:opacity-100 absolute right-4 top-0 flex items-center gap-1">
      <Popover open={showEmojiPicker} onOpenChange={setShowEmojiPicker}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Smile className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 border-none" align="end">
          <EmojiPicker
            onEmojiClick={handleEmojiSelect}
            width={320}
            height={400}
          />
        </PopoverContent>
      </Popover>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => {
          replyCallback(message.id);
          return true;
        }}
      >
        <MessageSquareIcon className="h-4 w-4" />
      </Button>
      {isOwner && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setIsEditing(true)}>
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onSelect={() => {
                if (window.confirm("Are you sure you want to delete this message?")) {
                  deleteMessageMutation.mutate();
                }
              }}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
};

const MessageItem = ({
  message,
  previousMessage,
  threadStateChanged,
}: {
  message: ExtendedMessage;
  previousMessage?: ExtendedMessage;
  threadStateChanged: (threadId: number | null | undefined) => void;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const { user: currentUser, token } = useUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const editMessageMutation = useMutation({
    mutationFn: async (content: string) => {
      const url = "toUserId" in message
        ? `/api/dm/${message.id}`
        : `/api/messages/${message.id}`;

      const response = await fetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          content,
          isDirectMessage: "toUserId" in message,
          toUserId: "toUserId" in message ? message.toUserId : undefined,
          fromUserId: "fromUserId" in message ? message.fromUserId : undefined,
        }),
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },
    onSuccess: () => {
      if ("channelId" in message && message.channelId) {
        queryClient.invalidateQueries({
          queryKey: [
            "/api/channels",
            message.channelId,
            "messages",
            message.threadId || undefined,
          ],
        });
      } else if ("toUserId" in message) {
        queryClient.invalidateQueries({
          queryKey: [
            "/api/dm",
            message.toUserId,
            message.threadId || undefined,
          ],
        });
      }
      setIsEditing(false);
      toast({
        title: "Success",
        description: "Message updated successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update message",
        variant: "destructive",
      });
    },
  });

  const showHeader =
    !previousMessage ||
    previousMessage.user.id !== message.user.id ||
    new Date(message.createdAt!).getTime() -
      new Date(previousMessage.createdAt!).getTime() >
      300000;

  const messageDate = new Date(message.createdAt!);
  const showDateHeader =
    !previousMessage ||
    !isSameDay(messageDate, new Date(previousMessage.createdAt!));

  const handleSaveEdit = () => {
    if (editContent.trim() !== message.content) {
      editMessageMutation.mutate(editContent);
    }
    setIsEditing(false);
  };

  return (
    <>
      {showDateHeader && <DateHeader date={messageDate} />}
      <div
        className={`group relative flex gap-x-3 hover:bg-accent/50 rounded-lg -mx-2 px-2 ${
          showHeader ? "mt-6" : "mt-1"
        }`}
        data-message-id={message.id}
        data-user-id={"userId" in message ? message.userId : message.fromUserId}
      >
        {showHeader && (
          <Avatar className="h-8 w-8 mt-1">
            <AvatarImage src={message.user.avatar || undefined} />
            <AvatarFallback>
              {message.user.username[0].toUpperCase()}
            </AvatarFallback>
          </Avatar>
        )}
        <div className={`flex-1 ${!showHeader ? "pl-11" : ""}`}>
          {showHeader && (
            <div className="flex items-center gap-x-2">
              <div className="text-sm font-semibold">
                {message.user.username}
              </div>
              <div className="text-xs text-muted-foreground">
                {format(messageDate, "p")}
              </div>
            </div>
          )}
          <div className="space-y-1">
            {isEditing ? (
              <div className="flex items-center gap-2">
                <Textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="flex-1"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSaveEdit();
                    }
                    if (e.key === "Escape") {
                      setIsEditing(false);
                      setEditContent(message.content);
                    }
                  }}
                />
                <Button onClick={handleSaveEdit}>Save</Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setIsEditing(false);
                    setEditContent(message.content);
                  }}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="text-sm leading-loose">
                {message.content}
              </div>
            )}
          </div>
          <MessageActions
            message={message}
            replyCallback={threadStateChanged}
            isEditing={isEditing}
            setIsEditing={setIsEditing}
            editContent={editContent}
            setEditContent={setEditContent}
            handleSaveEdit={handleSaveEdit}
          />
        </div>
      </div>
    </>
  );
};

const DateHeader = ({ date }: { date: Date }) => {
  let displayDate = "";
  if (isToday(date)) {
    displayDate = "Today";
  } else if (isYesterday(date)) {
    displayDate = "Yesterday";
  } else {
    displayDate = format(date, "MMMM d, yyyy");
  }

  return (
    <div className="sticky top-2 z-10 flex justify-center my-6">
      <div className="bg-accent/80 backdrop-blur-sm text-accent-foreground px-3 py-1 rounded-full text-sm font-medium">
        {displayDate}
      </div>
    </div>
  );
};

type Props = {
  channelId: number | null;
  userId: number | null;
  threadId?: number | null;
  threadStateChanged: (threadId: number | null | undefined) => void;
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

export default function MessageList({
  channelId,
  userId,
  threadId,
  threadStateChanged,
}: Props) {
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
  const [showSearch, setShowSearch] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const queryClient = useQueryClient();

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

  const { data: readDMs } = useQuery<DirectMessage[]>({
    queryKey: ["/api/users", userId, "read-direct-messages"],
    queryFn: async () => {
      if (!userId) return [];
      const response = await fetch(
        `/api/users/${userId}/read-direct-messages`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      if (!response.ok) throw new Error("Failed to fetch read messages");
      return response.json();
    },
    enabled: !!userId,
  });

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
      ? ["/api/dm", userId, threadId]
      : ["/api/channels", channelId, "messages", threadId],
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
      if (threadId) {
        queryParams.append("threadId", threadId.toString());
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

  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) return;

    const scrollableElement = scrollContainer.querySelector(
      "[data-radix-scroll-area-viewport]",
    );
    if (!scrollableElement) {
      console.log("Could not find scrollable element");
      return;
    }
    scrollableElementRef.current = scrollableElement as HTMLDivElement;
  }, [scrollRef.current]);

  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) return;

    const scrollableElement = scrollableElementRef.current;
    if (!scrollableElement) return;
    const debouncedSavePosition = debounce((position: number) => {
      const storageKey = threadId ? "" : channelId
        ? `chat-scroll-position-channel-${channelId}`
        : userId
        ? `chat-scroll-position-user-${userId}`
        : "";

      if (storageKey) {
        const maxScroll =
          scrollableElement.scrollHeight - scrollableElement.clientHeight;
        console.log(maxScroll, position);
        if (maxScroll - position > 100) {
          localStorage.setItem(storageKey, position.toString());
          console.log(`[Scroll] Saved position ${position} for ${storageKey}`);
        } else {
          localStorage.removeItem(storageKey);
          console.log(`[Scroll] Cleared saved position for ${storageKey}`);
        }
      }
    }, 1000);

    const handleScroll = async () => {
      if (loadingMoreRef.current) return;

      const { scrollTop, scrollHeight, clientHeight } = scrollableElement;
      const distanceFromTop = scrollTop;
      const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);

      debouncedSavePosition(scrollTop);

      if (distanceFromTop < 200 && hasNextPage && !isFetchingNextPage) {
        loadingMoreRef.current = true;
        console.log("[Scroll] Loading older messages...");

        const previousHeight = scrollHeight;
        const previousScrollTop = scrollTop;

        try {
          await fetchNextPage();

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

  useEffect(() => {
    if (!scrollRef.current) return;

    const scrollableElement = scrollableElementRef.current;
    if (!scrollableElement) return;
    const storageKey = threadId ? "" : channelId
      ? `chat-scroll-position-channel-${channelId}`
      : userId
      ? `chat-scroll-position-user-${userId}`
      : "";
    const savedPosition = localStorage.getItem(storageKey);

    if (savedPosition && isInitialLoadRef.current) {
      isInitialLoadRef.current = false;

      const restorePosition = () => {
        const targetPosition = parseInt(savedPosition);
        scrollableElement.scrollTop = targetPosition;

        if (Math.abs(scrollableElement.scrollTop - targetPosition) > 10) {
          scrollRestorationTimeoutRef.current = setTimeout(restorePosition, 50);
        } else {
          console.log(
            `[Scroll] Successfully restored position ${targetPosition}`,
          );
        }
      };

      scrollRestorationTimeoutRef.current = setTimeout(restorePosition, 100);
    } else if (!savedPosition) {
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

  const updateLastRead = useCallback(
    async (messageId: number, cid: number | null, uid: number | null) => {
      if (
        !messageId ||
        processedMessagesRef.current.has(messageId) ||
        !(cid || uid)
      )
        return;

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

          if (retryTimeoutsRef.current.has(messageId)) {
            clearTimeout(retryTimeoutsRef.current.get(messageId));
            retryTimeoutsRef.current.delete(messageId);
          }

          const retryTimeout = setTimeout(() => {
            console.log(
              `[MessageTracking] Retrying to mark message ${messageId} as read`,
            );
            processedMessagesRef.current.delete(messageId);
            updateLastRead(messageId, cid, uid);
          }, 1000);

          retryTimeoutsRef.current.set(messageId, retryTimeout);
        } else {
          console.log(
            `[MessageTracking] Successfully marked message ${messageId} as read`,
          );
          processedMessagesRef.current.add(messageId);

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
        processedMessagesRef.current.delete(messageId);
      }
    },
    [token],
  );

  useEffect(() => {
    if (!(channelId || userId)) return;

    const options: IntersectionObserverInit = {
      root: document.getElementById("scroll-container"),
      threshold: [0.1, 0.3, 0.5, 0.7],
      rootMargin: "50px 0px",
    };

    const handleIntersection = (entries: IntersectionObserverEntry[]) => {
      entries.forEach((entry) => {
        const messageId = parseInt(
          entry.target.getAttribute("data-message-id") || "0",
        );
        const uid = parseInt(entry.target.getAttribute("data-user-id") || "0");

        if (uid === currentUser?.id) {
          return;
        }

        if (entry.intersectionRatio >= 0.5 && messageId) {
          if (debounceTimeoutRef.current) {
            clearTimeout(debounceTimeoutRef.current);
          }

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

    return () => {
      console.log("[MessageTracking] Cleaning up intersection observer");
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      retryTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
      retryTimeoutsRef.current.clear();
      observer.disconnect();
      observerRef.current = null;
      processedMessagesRef.current.clear();
    };
  }, [channelId, updateLastRead, userId]);

  useEffect(() => {
    if (!(channelId || userId)) return;
    const storageKey = threadId ? "" : channelId
      ? `chat-scroll-position-channel-${channelId}`
      : userId
      ? `chat-scroll-position-user-${userId}`
      : "";

    return () => {
      if (scrollableElementRef.current) {
        const position = scrollableElementRef.current.scrollTop;
        const maxScroll =
          scrollableElementRef.current.scrollHeight -
          scrollableElementRef.current.clientHeight;

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

  useEffect(() => {
    if (!observerRef.current) return;

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

      const observer = observerRef.current;
      if (observer) {
        messageElements.forEach((element) => {
          if (element instanceof Element) {
            const messageId = parseInt(
              element.getAttribute("data-message-id") || "0",
            );
            const uid = parseInt(element.getAttribute("data-user-id") || "0");

            if (
              processedMessagesRef.current.has(messageId) ||
              uid === currentUser?.id
            ) {
              return;
            }

            observer.unobserve(element);
            observer.observe(element);
          }
        });
      }
    }, 100);
  }, [messagesData, channelId, currentUser?.id]);

  useEffect(() => {
    const storageKey = threadId ? "" : channelId
      ? `chat-scroll-position-channel-${channelId}`
      : userId
      ? `chat-scroll-position-user-${userId}`
      : "";
    if (!storageKey) {
      return;
    }

    return () => {
      if (scrollableElementRef.current) {
        const position = scrollableElementRef.current.scrollTop;
        localStorage.setItem(storageKey, position.toString());
      }
    };
  }, [channelId, userId]);

  useEffect(() => {
    const storageKey = threadId ? "" : channelId
      ? `chat-scroll-position-channel-${channelId}`
      : userId
      ? `chat-scroll-position-user-${userId}`
      : "";
    const savedPosition = localStorage.getItem(storageKey);

    if (scrollableElementRef.current && savedPosition) {
      setTimeout(() => {
        if (scrollableElementRef.current) {
          scrollableElementRef.current.scrollTop = parseInt(savedPosition);
        }
      }, 100);
    }
  }, [channelId, userId]);

  useEffect(() => {
    setShowSearch(!!(searchResults));
  }, [searchResults]);

  const handleSearchResults = (results: SearchResult[]) => {
    setSearchResults(results);
    setShowSearch(true);
  };

  const handleSearchResultClick = (result: SearchResult) => {
    // Handle clicking a search result
    console.log('Search result clicked:', result);
    setShowSearch(false);
  };

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

  const getHeaderText = () => {
    if (threadId) {
      return (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              threadStateChanged(null);
                            return true;
            }}
            className="h-8 w-8"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span></span>
        </div>
      );
    }
    if (userId && chatPartner) {
      return chatPartner.username;
    }
    if (channelId && channel) {
      return `#${channel.name}`;
    }
    return "";
  };


  const allMessages = messagesData?.pages.flatMap((page) => page.data) || [];

  return (
    <div ref={scrollRef} className="flex flex-col h-full overflow-hidden">
      {getHeaderText() && (
        <div className="border-b px-6 py-2 h-14 flex items-center">
          <h2 className="text-lg font-semibold">{getHeaderText()}</h2>
          <div className="flex-1">
            <SearchBar
              channelId={channelId}
              userId={userId}
              onResultsChange={handleSearchResults}
            />
          </div>
        </div>
      )}
      <ScrollArea className="flex-1">
        <div className="px-6 py-4">
          <div className="space-y-4">
            {allMessages?.map((message: ExtendedMessage, i: number) => {
              const elements = [
                <MessageItem
                  key={message.id}
                  message={message}
                  previousMessage={allMessages[i - 1]}
                  threadStateChanged={threadStateChanged}
                />
              ];

              if (!threadId && (message.replyCount || 0) > 0) {
                elements.push(
                  <div key={`${message.id}-replies`} className="pl-12 mt-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        if (threadStateChanged) {
                          threadStateChanged(message.id);
                        }
                        return true;
                      }}
                    >
                      <MessageSquare className="h-3 w-3 mr-1" />
                      {message.replyCount}{" "}
                      {message.replyCount === 1 ? "reply" : "replies"}
                    </Button>
                  </div>
                );
              }
              if (message.attachments && message.attachments.length > 0) {
                let el = (
                    <div className="mt-2 space-y-2">
                      {message.attachments.map((attachment, index) => {
                        const isImage = attachment.fileType.startsWith(
                          "image/",
                        );

                        return (
                          <div
                            key={index}
                            className="group relative"
                          >
                            {isImage ? (
                              <div className="relative max-w-lg rounded-lg overflow-hidden">
                                <img
                                  src={attachment.url}
                                  alt={attachment.fileName}
                                  className="max-w-full h-auto rounded-lg"
                                  loading="lazy"
                                />
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                  <a
                                    href={attachment.url}
                                    download
                                    className="flex items-center gap-2 bg-background/90 text-foreground px-3 py-2 rounded-md hover:bg-background/95 transition-colors"
                                    onClick={(e) =>
                                      e.stopPropagation()
                                    }
                                  >
                                    <Download className="h-4 w-4" />
                                    Download
                                  </a>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-3 bg-accent/30 p-3 rounded-lg text-sm max-w-lg group-hover:bg-accent/40 transition-colors">
                                {/* File type icon */}
                                {attachment.fileType ===
                                  "application/pdf" ? (
                                  <FileText className="h-8 w-8 text-red-500" />
                                ) : attachment.fileType.startsWith(
                                    "video/",
                                  ) ? (
                                  <Film className="h-8 w-8 text-blue-500" />
                                ) : attachment.fileType.startsWith(
                                    "audio/",
                                  ) ? (
                                  <Music className="h-8 w-8 text-purple-500" />
                                ) : attachment.fileType.includes("zip") ||
                                  attachment.fileType.includes("rar") ? (
                                  <Archive className="h-8 w-8 text-yellow-500" />
                                ) : (
                                  <FileIcon className="h-8 w-8 text-muted-foreground" />
                                )}

                                <div className="flex-1 min-w-0">
                                  <p className="font-medium truncate">
                                    {attachment.fileName}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {formatFileSize(
                                      attachment.fileSize,
                                    )}
                                  </p>
                                </div>

                                <a
                                  href={attachment.url}
                                  download
                                  className="flex items-center gap-1 text-primary hover:text-primary/80 transition-colors"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Download className="h-4 w-4" />
                                  <span className="sr-only">
                                    Download {attachment.fileName}
                                  </span>
                                </a>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                elements.push(el);
              }
              

              return elements;
            })}                    
          </div>
        </div>
      </ScrollArea>
      <Separator />
      <div className="p-4">
        <MessageInput
          channelId={channelId}
          userId={userId}
          threadId={threadId}
          dmChatName={chatPartner?.username}
        />
      </div>
      <SearchResults
        results={searchResults}
        onResultClick={handleSearchResultClick}
        isVisible={showSearch}
      />
    </div>
  );
}

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

function formatFileSize(bytes: number) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}