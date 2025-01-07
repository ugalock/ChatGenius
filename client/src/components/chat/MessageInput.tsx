import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Paperclip, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useWebSocket } from "@/hooks/use-websocket";
import { useUser } from "@/hooks/use-user";

type Props = {
  channelId: number | null;
  userId: number | null;
};

export default function MessageInput({ channelId, userId }: Props) {
  const [content, setContent] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout>();
  const { toast } = useToast();
  const { user, token } = useUser();
  const { sendMessage } = useWebSocket(user?.id, token);
  const queryClient = useQueryClient();

  const sendMessageMutation = useMutation({
    mutationFn: async (data: { content: string; files?: FileList }) => {
      const url = userId 
        ? `/api/dm/${userId}`
        : `/api/channels/${channelId}/messages`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },
    onSuccess: () => {
      // Invalidate the appropriate query based on whether it's a DM or channel message
      if (userId) {
        queryClient.invalidateQueries({ queryKey: ["/api/dm", userId] });
      } else {
        queryClient.invalidateQueries({
          queryKey: ["/api/channels", channelId, "messages"],
        });
      }
      setContent("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    onError: (error) => {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to send message",
        variant: "destructive",
      });
    },
  });

  const handleTyping = () => {
    if (!isTyping) {
      setIsTyping(true);
      // Send typing indicator to the appropriate context
      if (userId) {
        sendMessage("typing_dm", { userId });
      } else {
        sendMessage("typing", { channelId });
      }
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
    }, 1000);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !content.trim() &&
      (!fileInputRef.current?.files || !fileInputRef.current.files.length)
    ) {
      return;
    }

    sendMessageMutation.mutate({
      content,
      files: fileInputRef.current?.files || undefined,
    });
  };

  const placeholder = userId 
    ? `Message ${user?.username || 'user'}`
    : `Message ${channelId ? '#channel' : ''}`;

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        multiple
        accept="image/*,application/pdf"
        onChange={() => {
          if (fileInputRef.current?.files?.length) {
            handleSubmit(new Event("submit") as any);
          }
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => fileInputRef.current?.click()}
      >
        <Paperclip className="h-5 w-5" />
      </Button>
      <Textarea
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          handleTyping();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
          }
        }}
        placeholder={placeholder}
        className="min-h-[44px] max-h-[200px]"
      />
      <Button
        type="submit"
        size="icon"
        disabled={sendMessageMutation.isPending}
      >
        <Send className="h-5 w-5" />
      </Button>
    </form>
  );
}