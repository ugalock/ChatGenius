import { useQuery } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useUser } from "@/hooks/use-user";
import type { User } from "@db/schema";

type ExtendedUser = User & {
  unreadCount: number;
};

type Props = {
  selectedUserId: number | null;
  onSelectUser: (userId: number) => void;
};

export default function DirectMessages({ selectedUserId, onSelectUser }: Props) {
  const { token, user: currentUser } = useUser();

  const { data: users } = useQuery<ExtendedUser[]>({
    queryKey: ["/api/users"],
    queryFn: async () => {
      const response = await fetch("/api/users", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error("Failed to fetch users");
      return response.json();
    },
  });

  // Filter out the current user from the list
  const otherUsers = users?.filter(user => user.id !== currentUser?.id) || [];

  return (
    <div className="p-4 border-b border-gray-700">
      <h2 className="mb-2 text-gray-400 uppercase text-sm">Direct Messages</h2>
      <ScrollArea className="flex-1">
        <div className="space-y-1">
          {otherUsers.map((user) => (
            <Button
              key={user.id}
              variant={user.id === selectedUserId ? "ghost" : "ghost"}
              className="w-full flex items-center mb-2 cursor-pointer hover:bg-gray-700 rounded justify-between"
              onClick={() => onSelectUser(user.id)}
            >
              <div className="flex items-center">
                <div className="relative">
                  <Avatar className="h-8 w-8 mr-2">
                    <AvatarImage src={user.avatar || undefined} />
                    <AvatarFallback>
                      {user.username[0].toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div 
                    className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white ${
                      user.status === 'online' ? 'bg-green-500' : 'bg-gray-500'
                    }`}
                  />
                </div>
                <span className="truncate">{user.username}</span>
              </div>
              <div className="flex items-center space-x-2">
                {user.unreadCount > 0 && (
                  <span className="bg-blue-500 rounded-full px-2 py-0.5 text-xs">
                    {user.unreadCount}
                  </span>
                )}
                <MessageCircle className="h-4 w-4" />
              </div>
            </Button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}