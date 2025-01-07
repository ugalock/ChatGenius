import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUser } from "@/hooks/use-user";
import { useForm } from "react-hook-form";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Channel } from "@db/schema";

type ExtendedChannel = Channel & {
  isMember: boolean;
  unread?: number;
};

type Props = {
  selectedChannelId: number | null;
  onSelectChannel: (channelId: number) => void;
};

export default function ChannelList({
  selectedChannelId,
  onSelectChannel,
}: Props) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const form = useForm<{ name: string; description: string }>();

  const { token } = useUser();
  const { data: channels } = useQuery<ExtendedChannel[]>({
    queryKey: ["/api/channels/all"],
    queryFn: async () => {
      const response = await fetch("/api/channels/all", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error("Failed to fetch channels");
      return response.json();
    },
  });

  const createChannel = useMutation({
    mutationFn: async (data: { name: string; description: string }) => {
      const response = await fetch("/api/channels", {
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
      queryClient.invalidateQueries({ queryKey: ["/api/channels/all"] });
      setOpen(false);
      form.reset();
    },
  });

  return (
    <div className="p-4 border-b border-gray-700">
      <h2 className="mb-2 text-gray-400 uppercase text-sm">Channels</h2>
      <ScrollArea className="flex-1">
        <div className="space-y-1 items-left">
          {channels?.map((channel) => (
            <Button
              key={channel.id}
              variant={channel.id === selectedChannelId ? "ghost" : "ghost"}
              className={`flex items-center mb-2 cursor-pointer hover:bg-gray-700 rounded w-full justify-between ${
                !channel.isMember ? "font-bold" : ""
              }`}
              onClick={() => onSelectChannel(channel.id)}
            >
              <div className="flex items-center">
                <MessageCircle className="h-4 w-4 mr-2" />
                <span className="truncate">{channel.name}</span>
              </div>
              {channel.unread && channel.unread > 0 && (
                <span className="bg-blue-500 rounded-full px-2 py-0.5 text-xs">
                  {channel.unread}
                </span>
              )}
            </Button>
          ))}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" className="text-white">
                <Plus className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Channel</DialogTitle>
              </DialogHeader>
              <form
                onSubmit={form.handleSubmit((data) =>
                  createChannel.mutate(data),
                )}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="name">Channel Name</Label>
                  <Input
                    id="name"
                    {...form.register("name", { required: true })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Input id="description" {...form.register("description")} />
                </div>
                <Button type="submit">Create</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </ScrollArea>
    </div>
  );
}