import { Settings, LogOut } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useUser } from "@/hooks/use-user";
import { useLocation } from "wouter";

const logout = () => {
  localStorage.removeItem("user-storage");
  window.location.reload();
};

export default function ProfileBar() {
  const { user } = useUser();
  const [_, setLocation] = useLocation();

  return (
    <div className="mt-auto p-4 border-t border-gray-700 flex items-center">
      <div className="relative">
        <Avatar className="h-5 w-5 mr-1">
          {user?.avatar ? (
            <AvatarImage src={user.avatar} alt={user?.username || 'User avatar'} />
          ) : (
            <AvatarFallback>{user?.username?.[0].toUpperCase()}</AvatarFallback>
          )}
        </Avatar>
        <div
          className={
            "absolute bottom-0 right-0 h-2 w-2 rounded-full border-2 border-white bg-green-500"
          }
        />
      </div>
      <div className="flex-1">
        <div className="font-medium mr-2">
          {user?.username || "Current User"}
        </div>
      </div>
      <Settings 
        className="w-5 h-5 cursor-pointer hover:text-gray-400 mr-2" 
        onClick={() => setLocation("/profile")}
      />
      <LogOut
        className="w-5 h-5 cursor-pointer hover:text-gray-400"
        onClick={logout}
      />
    </div>
  );
}