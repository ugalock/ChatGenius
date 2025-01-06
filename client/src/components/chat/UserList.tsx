import { useQuery } from "@tanstack/react-query";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { User } from "@db/schema";

export default function UserList() {
  const { data: users } = useQuery<User[]>({
    queryKey: ["/api/users"]
  });

  const onlineUsers = users?.filter(user => user.status === "online") || [];
  const offlineUsers = users?.filter(user => user.status === "offline") || [];

  return (
    <div className="h-full p-4">
      <h2 className="text-lg font-semibold mb-4">Users</h2>
      <ScrollArea className="h-[calc(100%-2rem)]">
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">
              Online - {onlineUsers.length}
            </h3>
            <div className="space-y-2">
              {onlineUsers.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center gap-2 p-2 rounded-md hover:bg-secondary"
                >
                  <div className="relative">
                    <Avatar className="h-8 w-8">
                      {user.avatar && <AvatarImage src={user.avatar} />}
                      <AvatarFallback>
                        {user.username[0].toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <Badge
                      variant="default"
                      className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-background bg-green-500"
                    />
                  </div>
                  <span className="text-sm">{user.username}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">
              Offline - {offlineUsers.length}
            </h3>
            <div className="space-y-2">
              {offlineUsers.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center gap-2 p-2 rounded-md hover:bg-secondary"
                >
                  <div className="relative">
                    <Avatar className="h-8 w-8">
                      {user.avatar && <AvatarImage src={user.avatar} />}
                      <AvatarFallback>
                        {user.username[0].toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <Badge
                      variant="default"
                      className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-background bg-gray-500"
                    />
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {user.username}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}