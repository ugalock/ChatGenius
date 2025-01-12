// components/SearchBar.tsx
import { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useQuery } from '@tanstack/react-query';
import { useUser } from '@/hooks/use-user';
import { Button } from '@/components/ui/button';
import { SearchResult } from "./SearchResults";

interface SearchBarProps {
  channelId?: number | null;
  userId?: number | null;
  onResultsChange: (results: SearchResult[]) => void;
}

export function SearchBar({ channelId, userId, onResultsChange }: SearchBarProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const { token } = useUser();

  // Implement debouncing for search term
  useEffect(() => {
    // Create a timeout to update the debounced value
    const timeoutId = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 300); // 300ms delay

    // Cleanup timeout on every searchTerm change or component unmount
    return () => {
      clearTimeout(timeoutId);
    };
  }, [searchTerm]);

  const { data: searchResults } = useQuery({
    queryKey: ['search', debouncedSearch, channelId, userId],
    queryFn: async () => {
      if (!debouncedSearch) return [];
      
      const params = new URLSearchParams({
        q: debouncedSearch,
        ...(channelId && { channelId: channelId.toString() }),
        ...(userId && { userId: userId.toString() }),
      });

      const response = await fetch(`/api/search?${params}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      
      if (!response.ok) throw new Error('Search failed');
      return response.json();
    },
    enabled: !!debouncedSearch,
  });

  // Update parent component with results
  useEffect(() => {
    onResultsChange(searchResults || []);
  }, [searchResults, onResultsChange]);

  const toggleSearch = () => {
    setIsSearchVisible(!isSearchVisible);
    if (!isSearchVisible) {
      // Reset search when hiding
      setSearchTerm('');
      setDebouncedSearch('');
      onResultsChange([]);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleSearch}
        className={isSearchVisible ? 'text-primary' : ''}
      >
        <Search className="h-4 w-4" />
      </Button>
      
      {isSearchVisible && (
        <div className="flex-1 transition-all duration-200">
          <Input
            placeholder="Search messages and files..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full"
            // Auto focus when shown
            autoFocus
            // Handle Escape key to close search
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                toggleSearch();
              }
            }}
          />
        </div>
      )}
    </div>
  );
}