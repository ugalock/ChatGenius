// components/SearchResults.tsx
import { format } from 'date-fns';
import { File } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

export interface SearchResult {
  id: number;
  content: string;
  createdAt: Date;
  type?: 'channel' | 'dm';
  channelId?: number;
  fromUserId?: number;
  toUserId?: number;
  attachments?: Attachment[];
  user: {
    username: string;
    avatar?: string;
  };
}

interface SearchResultsProps {
  results: SearchResult[];
  onResultClick: (result: SearchResult) => void;
}

export function SearchResults({ results, onResultClick }: SearchResultsProps) {
  return (
    <ScrollArea className="h-[calc(100vh-200px)]">
      <div className="space-y-4 p-4">
        {results.map((result) => (
          <div
            key={`${result.type}-${result.id}`}
            className="flex flex-col space-y-2 p-3 hover:bg-accent rounded-lg cursor-pointer"
            onClick={() => onResultClick(result)}
          >
            <div className="flex items-center space-x-2">
              <span className="font-medium">{result.user.username}</span>
              <span className="text-xs text-muted-foreground">
                {format(new Date(result.createdAt), 'MMM d, yyyy h:mm a')}
              </span>
            </div>

            <p className="text-sm line-clamp-2">{result.content}</p>

            {result.attachments?.map((attachment, i) => (
              <div key={i} className="flex items-center space-x-2 text-xs text-muted-foreground">
                <File className="h-4 w-4" />
                <span>{attachment.fileName}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}