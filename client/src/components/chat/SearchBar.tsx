import { useState, useEffect } from 'react';
import { Search, Image, Headset, Video, File, MessageCircle, CaseSensitive } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useQuery } from '@tanstack/react-query';
import { useUser } from '@/hooks/use-user';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { SearchResult } from "./SearchResults";

interface SearchBarOptionsProps {
  updateSearchOptions: (options: { [key: string]: boolean }) => void;
}

function SearchBarOptions({ updateSearchOptions }: SearchBarOptionsProps) {
  const [normalSearch, setNormalSearch] = useState(true);
  const [advancedSearch, setAdvancedSearch] = useState<{ [key: string]: boolean }>({});
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (normalSearch) {
      setAdvancedSearch({});
    }
    updateSearchOptions({ normalSearch, ...advancedSearch });
  }, [normalSearch]);

  useEffect(() => {
    const advancedOptionsSelected = Object.entries(advancedSearch).filter(([key, value]) => value).map(([key]) => key);
    if (advancedOptionsSelected.length === 0) {
      setNormalSearch(true);
    } else {
      updateSearchOptions({ normalSearch, ...advancedSearch });
    }
  }, [advancedSearch]);

  function handleIsOpenChange(open: boolean) {
    setIsOpen(open);
    if (open) {
      setNormalSearch(false);
    } else if (!open && !normalSearch) {
      const advancedOptionsSelected = Object.entries(advancedSearch).filter(([key, value]) => value).map(([key]) => key);
      if (advancedOptionsSelected.length === 0) {
        setNormalSearch(true);
      }
    }
  }

  function handleOptionChange(isNormal: boolean, option: string, value: boolean) {
    if (isNormal) {
      setNormalSearch(!normalSearch);
    } else {
      setAdvancedSearch(prev => ({ ...prev, [option]: value }));
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant={normalSearch ? "custom" : "ghost"}
        size="icon"
        title="Normal Search"
        onClick={() => handleOptionChange(true, '', false)}
        className="data-[state=active]:translate-y-[1px] transition-transform"
        data-state={normalSearch ? "active" : "inactive"}
      >
        <CaseSensitive />
      </Button>
      <DropdownMenu open={isOpen} onOpenChange={handleIsOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button variant={isOpen ? "custom" : "ghost"} size="icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24px" height="24px"><path d="M 11.134766 1.015625 C 10.87173 1.0029355 10.606766 1.0089531 10.337891 1.0332031 C 8.1134793 1.2339019 6.3361915 2.7940047 5.609375 4.8203125 C 3.8970488 5.1768547 2.4372723 6.3040092 1.671875 7.9570312 C 0.73398779 9.9832932 1.1972842 12.300966 2.5878906 13.943359 C 2.0402798 15.605243 2.2847784 17.435582 3.3320312 18.923828 C 4.6182099 20.749715 6.8585216 21.506646 8.9765625 21.123047 C 10.141577 22.428211 11.848518 23.131209 13.662109 22.966797 C 15.886468 22.766103 17.663776 21.205925 18.390625 19.179688 C 20.102951 18.823166 21.562728 17.695148 22.328125 16.042969 C 23.265996 14.016742 22.802659 11.700983 21.412109 10.058594 C 21.960472 8.3962359 21.714488 6.5649514 20.666016 5.0761719 C 19.379837 3.2502847 17.141478 2.4933536 15.023438 2.8769531 C 14.031143 1.7652691 12.645932 1.0885273 11.134766 1.015625 z M 11.025391 2.5136719 C 11.920973 2.5488153 12.753413 2.8736921 13.429688 3.4199219 C 13.316626 3.4759644 13.19815 3.514457 13.087891 3.578125 L 9.5683594 5.609375 C 8.9563594 5.962375 8.5763594 6.6133125 8.5683594 7.3203125 L 8.515625 12.238281 L 7.2402344 11.480469 C 6.9362344 11.300469 6.75 10.972141 6.75 10.619141 L 6.75 6.7851562 C 6.75 4.6491563 8.3075938 2.74225 10.433594 2.53125 C 10.632969 2.5115 10.83048 2.5060234 11.025391 2.5136719 z M 16.125 4.2558594 C 17.398584 4.263418 18.639844 4.8251563 19.417969 5.9101562 C 20.070858 6.819587 20.310242 7.9019929 20.146484 8.9472656 C 20.04127 8.8772414 19.948325 8.7942374 19.837891 8.7304688 L 16.318359 6.6992188 C 15.706359 6.3452187 14.953891 6.3424531 14.337891 6.6894531 L 10.052734 9.1035156 L 10.070312 7.6171875 C 10.074313 7.2641875 10.264313 6.9406719 10.570312 6.7636719 L 13.890625 4.8476562 C 14.584375 4.4471562 15.36085 4.2513242 16.125 4.2558594 z M 5.2832031 6.4726562 C 5.2752362 6.598305 5.25 6.7206252 5.25 6.8476562 L 5.25 10.908203 C 5.25 11.615203 5.6224688 12.270859 6.2304688 12.630859 L 10.466797 15.136719 L 9.171875 15.863281 C 8.863875 16.036281 8.4876406 16.034422 8.1816406 15.857422 L 4.859375 13.939453 C 3.009375 12.871453 2.1375781 10.567094 3.0175781 8.6210938 C 3.4795583 7.6006836 4.2963697 6.8535791 5.2832031 6.4726562 z M 15.326172 8.0078125 C 15.496922 8.0088125 15.667313 8.0540781 15.820312 8.1425781 L 19.140625 10.060547 C 20.990625 11.128547 21.864375 13.432906 20.984375 15.378906 C 20.522287 16.399554 19.703941 17.146507 18.716797 17.527344 C 18.724792 17.401473 18.75 17.279602 18.75 17.152344 L 18.75 13.089844 C 18.75 12.382844 18.377531 11.729141 17.769531 11.369141 L 13.537109 8.8632812 L 14.830078 8.1367188 C 14.984078 8.0502187 15.155422 8.0068125 15.326172 8.0078125 z M 12.025391 9.7128906 L 13.996094 10.880859 L 13.96875 13.167969 L 11.974609 14.289062 L 10.003906 13.119141 L 10.03125 10.832031 L 12.025391 9.7128906 z M 15.482422 11.763672 L 16.759766 12.519531 C 17.063766 12.699531 17.25 13.027859 17.25 13.380859 L 17.25 17.214844 C 17.25 19.350844 15.692406 21.25775 13.566406 21.46875 C 12.450934 21.579248 11.393768 21.245187 10.570312 20.580078 C 10.683374 20.524036 10.80185 20.485543 10.912109 20.421875 L 14.429688 18.390625 C 15.041688 18.037625 15.421688 17.386688 15.429688 16.679688 L 15.482422 11.763672 z M 13.947266 14.898438 L 13.929688 16.382812 C 13.925687 16.735813 13.735687 17.059328 13.429688 17.236328 L 10.109375 19.152344 C 8.259375 20.220344 5.8270313 19.825844 4.5820312 18.089844 C 3.9291425 17.180413 3.6897576 16.098007 3.8535156 15.052734 C 3.9587303 15.122759 4.0516754 15.205763 4.1621094 15.269531 L 7.6816406 17.300781 C 8.2936406 17.654781 9.0461094 17.657547 9.6621094 17.310547 L 13.947266 14.898438 z" /></svg>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-8">
          <div className="flex flex-col gap-2 p-2">
            <Button
              variant={advancedSearch.message ? "outline" : "ghost"}
              size="sm"
              title="Messages"
              className="justify-start data-[state=active]:translate-y-[1px] transition-transform"
              disabled={normalSearch}
              onClick={() => handleOptionChange(false, 'message', advancedSearch.message !== undefined ? !advancedSearch.message : true)}
              data-state={advancedSearch.message ? "active" : "inactive"}
            >
              <MessageCircle className="mr-2 h-4 w-4" />
            </Button>
            <Button
              variant={advancedSearch.text ? "outline" : "ghost"}
              size="sm"
              title="File"
              className="justify-start data-[state=active]:translate-y-[1px] transition-transform"
              disabled={normalSearch}
              onClick={() => handleOptionChange(false, 'text', !advancedSearch.text)}
              data-state={advancedSearch.text ? "active" : "inactive"}
            >
              <File className="mr-2 h-4 w-4" />
            </Button>
            <Button
              variant={advancedSearch.image ? "outline" : "ghost"}
              size="sm"
              title="Image"
              className="justify-start data-[state=active]:translate-y-[1px] transition-transform"
              disabled={normalSearch}
              onClick={() => handleOptionChange(false, 'image', !advancedSearch.image)}
              data-state={advancedSearch.image ? "active" : "inactive"}
            >
              <Image className="mr-2 h-4 w-4" />
            </Button>
            <Button
              variant={advancedSearch.audio ? "outline" : "ghost"}
              size="sm"
              title="Audio"
              className="justify-start data-[state=active]:translate-y-[1px] transition-transform"
              disabled={normalSearch}
              onClick={() => handleOptionChange(false, 'audio', !advancedSearch.audio)}
              data-state={advancedSearch.audio ? "active" : "inactive"}
            >
              <Headset className="mr-2 h-4 w-4" />
            </Button>
            <Button
              variant={advancedSearch.video ? "outline" : "ghost"}
              size="sm"
              title="Video"
              className="justify-start data-[state=active]:translate-y-[1px] transition-transform"
              disabled={normalSearch}
              onClick={() => handleOptionChange(false, 'video', !advancedSearch.video)}
              data-state={advancedSearch.video ? "active" : "inactive"}
            >
              <Video className="mr-2 h-4 w-4" />
            </Button>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

interface SearchData {
  channelId?: number | null;
  userId?: number | null;
  searchOptions?: string[];
  searchTerm: string;
}

interface SearchBarProps {
  channelId?: number | null;
  userId?: number | null;
  onResultsChange: (results: SearchResult[]) => void;
}

export function SearchBar({ channelId, userId, onResultsChange }: SearchBarProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [isSearchVisible, setIsSearchVisible] = useState(true);
  const [searchOptions, setSearchOptions] = useState<{ [key: string]: boolean }>({ normalSearch: true });
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

      const data: SearchData = {searchTerm: debouncedSearch};
      if (channelId) {
        data.channelId = channelId;
      }
      if (userId) {
        data.userId = userId;
      }
      if (!searchOptions.normalSearch) {
        const options : string[] = [];
        Object.entries(searchOptions).forEach(([key, value]) => {
          if (value) {
            options.push(key);
          }
        });
        data.searchOptions = options;
      }

      const response = await fetch(`/api/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
        credentials: 'include',
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
    setIsSearchVisible(isSearchVisible);
    setSearchTerm('');
    setDebouncedSearch('');
    onResultsChange([]);
  };

  return (
  <div className="relative ml-auto">
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleSearch}
      className={`${isSearchVisible ? 'text-primary' : ''} absolute right-80 top-1/2 -translate-y-1/2`}
    >
      <Search  />
    </Button>
    
    {isSearchVisible && (
      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-80 z-50">
        <div className="relative flex items-center gap-2">
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
          <div className="relative">
            <SearchBarOptions updateSearchOptions={setSearchOptions} />
          </div>
        </div>
      </div>
    )}
  </div>
);
}