import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useUser } from "@/hooks/use-user";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

const profileSchema = z.object({
  bio: z.string().max(500, "Bio must be less than 500 characters"),
  avatar: z.string().optional(),
  personalityTraits: z.array(z.string()).default([]),
  responseStyle: z.string().max(1000, "Response style must be less than 1000 characters"),
  writingStyle: z.string().max(1000, "Writing style must be less than 1000 characters"),
  useAiResponse: z.boolean().default(false),
});

type FormData = z.infer<typeof profileSchema>;

export default function ProfilePage() {
  const { user, token, updateProfile } = useUser();
  const { toast } = useToast();
  const [_, setLocation] = useLocation();
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [traits, setTraits] = useState<string[]>(
    user?.avatarConfig?.personalityTraits ? 
    user.avatarConfig.personalityTraits : 
    []
  );

  const form = useForm<FormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      bio: user?.bio || "",
      avatar: user?.avatar || "",
      personalityTraits: traits ? traits :user?.avatarConfig?.personalityTraits ? 
        user.avatarConfig.personalityTraits : 
        [],
      responseStyle: user?.avatarConfig?.responseStyle || "",
      writingStyle: user?.avatarConfig?.writingStyle || "",
      useAiResponse: user?.useAiResponse || false,
    },
  });

  const addTrait = () => {
    setTraits([...traits, ""]);
  };

  const removeTrait = (index: number) => {
    const newTraits = traits.filter((_, i) => i !== index);
    setTraits(newTraits);
    form.setValue("personalityTraits", newTraits);
  };

  const updateTrait = (index: number, value: string) => {
    const newTraits = [...traits];
    newTraits[index] = value;
    setTraits(newTraits);
    form.setValue("personalityTraits", newTraits);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setAvatarFile(file);
      // Create a preview URL for the selected file
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const onSubmit = async (data: FormData) => {
    try {
      const formData = new FormData();
      formData.append("bio", data.bio);
      if (avatarFile) {
        formData.append("avatar", avatarFile);
      }
      console.log(traits);
      formData.append("personalityTraits", JSON.stringify(traits));
      formData.append("responseStyle", data.responseStyle);
      formData.append("writingStyle", data.writingStyle);
      formData.append("useAiResponse", data.useAiResponse.toString());

      await updateProfile(formData, token!);
      toast({
        title: "Success",
        description: "Profile updated successfully",
      });

      // Wait a bit before redirecting to ensure the toast is visible
      setTimeout(() => setLocation("/"), 1500);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update profile",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md mx-4">
        <CardHeader className="relative">
          <Button
            variant="ghost"
            size="icon"
            className="absolute left-4 top-4"
            onClick={() => setLocation("/")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <CardTitle className="text-2xl text-center">Edit Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="useAiResponse"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Auto-Response</FormLabel>
                      <FormMessage />
                      <div className="text-sm text-muted-foreground">
                        Allow your AI to automatically respond to messages
                      </div>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              
              <div className="flex flex-col items-center space-y-4">
                <Avatar className="h-24 w-24">
                  {previewUrl ? (
                    <AvatarImage src={previewUrl} alt="Avatar preview" />
                  ) : user?.avatar ? (
                    <AvatarImage src={user.avatar} alt={user.username} />
                  ) : (
                    <AvatarFallback>{user?.username?.[0].toUpperCase()}</AvatarFallback>
                  )}
                </Avatar>
                <div className="flex flex-col items-center">
                  <Label htmlFor="avatar" className="cursor-pointer text-blue-500 hover:text-blue-600">
                    Change Avatar
                  </Label>
                  <Input
                    id="avatar"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </div>
              </div>

              <FormField
                control={form.control}
                name="bio"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bio</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Tell us about yourself..."
                        className="resize-none"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-2">
                <FormLabel>Personality Traits</FormLabel>
                {traits.map((trait, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      value={trait}
                      onChange={(e) => updateTrait(index, e.target.value)}
                      placeholder="Enter a personality trait"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => removeTrait(index)}
                    >
                      -
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={addTrait}
                >
                  + Add Trait
                </Button>
              </div>

              <FormField
                control={form.control}
                name="responseStyle"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Response Style</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="How should your AI respond?"
                        className="resize-none"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="writingStyle"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Writing Style</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="What writing style should your AI use?"
                        className="resize-none"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex gap-4">
                <Button 
                  type="button" 
                  variant="outline" 
                  className="flex-1"
                  onClick={() => setLocation("/")}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  className="flex-1" 
                  disabled={form.formState.isSubmitting}
                >
                  Save Changes
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}