import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Paperclip, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/hooks/use-user";

type Props = {
  channelId: number | null;
  userId: number | null;
  threadId?: number | null;
  dmChatName: string | undefined;
  sendMessage: (type: string, payload: any) => void;
};

interface FilePreview {
  name: string;
  size: number;
  type: string;
}

export default function MessageInput({ channelId, userId, threadId, dmChatName, sendMessage }: Props) {
  const [content, setContent] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<FilePreview[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout>();
  const { toast } = useToast();
  const { token } = useUser();
  const queryClient = useQueryClient();

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const sendMessageMutation = useMutation({
    mutationFn: async (data: { content: string; files?: FileList }) => {
      const formData = new FormData();

      // Important: Ensure content is always a non-empty string
      const messageContent = data.content.trim() || "(attachment)";
      formData.append("content", messageContent);

      if (data.files) {
        Array.from(data.files).forEach((file) => {
          formData.append("files", file);
        });
      }

      if (threadId) {
        formData.append("threadId", threadId.toString());
      }

      const url = userId
        ? `/api/dm/${userId}`
        : `/api/channels/${channelId}/messages`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      return response.json();
    },
    onSuccess: () => {
      if (userId) {
        queryClient.invalidateQueries({ queryKey: ["/api/dm", userId, threadId] });
      } else {
        queryClient.invalidateQueries({
          queryKey: ["/api/channels", channelId, "messages", threadId],
        });
      }
      setContent("");
      setAttachedFiles([]);
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    // Update the UI with file previews
    const previews: FilePreview[] = Array.from(files).map(file => ({
      name: file.name,
      size: file.size,
      type: file.type
    }));
    setAttachedFiles(previews);
  };

  const removeFile = (fileName: string) => {
    setAttachedFiles(prev => prev.filter(file => file.name !== fileName));
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Allow sending if there's either content or files
    if (!content.trim() && !fileInputRef.current?.files?.length) {
      return;
    }

    sendMessageMutation.mutate({
      content: content.trim(),
      files: fileInputRef.current?.files || undefined,
    });
  };

  const placeholder = userId
    ? `Message ${dmChatName}`
    : threadId
    ? "Reply in thread"
    : `Message ${channelId ? "#channel" : ""}`;

  return (
    <div className="space-y-2">
      {/* File Attachments Preview */}
      {attachedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 p-2 bg-accent/50 rounded-md">
          {attachedFiles.map((file) => (
            <div
              key={file.name}
              className="flex items-center gap-2 bg-background p-2 rounded-md text-sm"
            >
              <span className="max-w-[200px] truncate">{file.name}</span>
              <span className="text-muted-foreground">({formatFileSize(file.size)})</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => removeFile(file.name)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Message Input Form */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          multiple
          accept="image/*,audio/*,video/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/*"
          onChange={handleFileChange}
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
    </div>
  );
}