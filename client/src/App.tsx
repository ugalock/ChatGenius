import { Switch, Route } from "wouter";
import { Loader2 } from "lucide-react";
import AuthPage from "./pages/AuthPage";
import ChatPage from "./pages/ChatPage";
import ProfilePage from "./pages/ProfilePage";
import { useUser } from "./hooks/use-user";

function App() {
  const { user } = useUser();

  // if (isLoading) {
  //   return (
  //     <div className="flex items-center justify-center min-h-screen bg-background">
  //       <Loader2 className="h-8 w-8 animate-spin text-primary" />
  //     </div>
  //   );
  // }

  // If no user, show auth page
  if (!user) {
    return <AuthPage />;
  }

  // User is authenticated, show main app
  return (
    <Switch>
      <Route path="/" component={ChatPage} />
      <Route path="/profile" component={ProfilePage} />
    </Switch>
  );
}

export default App;