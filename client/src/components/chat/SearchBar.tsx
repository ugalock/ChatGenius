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
    const timeoutId = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 300);

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
    <div className="relative ml-auto">
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleSearch}
        className={`${isSearchVisible ? 'text-primary' : ''} ml-auto`}
      >
        <Search className="h-4 w-4" />
      </Button>

      {isSearchVisible && (
        <div className="absolute right-0 top-full mt-2 w-80 z-50">
          <div className="relative">
            <div className="absolute inset-0 bg-background/80 backdrop-blur-sm rounded-lg -m-2" />
            <Input
              placeholder="Search messages and files..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full relative"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  toggleSearch();
                }
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}