import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSearch } from '@/hooks/useSearch';

export default function SearchBar() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const search = useSearch(workspaceId ?? '');

  const [isFocused, setIsFocused] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const showDropdown = isFocused && search.suggestions.length > 0;

  // Ctrl/Cmd+K global shortcut
  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setIsFocused(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const navigateToSearch = useCallback(
    (q: string) => {
      if (!workspaceId) return;
      search.setQuery(q);
      setIsFocused(false);
      navigate(`/workspaces/${workspaceId}/search?q=${encodeURIComponent(q)}`);
    },
    [workspaceId, navigate, search],
  );

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setIsFocused(false);
      inputRef.current?.blur();
      return;
    }

    if (!showDropdown) {
      if (e.key === 'Enter' && search.query.trim()) {
        navigateToSearch(search.query.trim());
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev < search.suggestions.length - 1 ? prev + 1 : 0,
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev > 0 ? prev - 1 : search.suggestions.length - 1,
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < search.suggestions.length) {
        navigateToSearch(search.suggestions[selectedIndex]);
      } else if (search.query.trim()) {
        navigateToSearch(search.query.trim());
      }
    }
  }

  function handleClear() {
    search.setQuery('');
    inputRef.current?.focus();
  }

  return (
    <div className="relative w-full max-w-md" role="search">
      <div className="relative">
        {/* Search icon */}
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>

        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls="search-suggestions"
          aria-activedescendant={
            selectedIndex >= 0 ? `suggestion-${selectedIndex}` : undefined
          }
          aria-label="Search records"
          placeholder="Search..."
          className="w-full pl-10 pr-16 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          value={search.query}
          onChange={(e) => {
            search.setQuery(e.target.value);
            setSelectedIndex(-1);
          }}
          onFocus={() => setIsFocused(true)}
          onKeyDown={handleKeyDown}
        />

        {/* Clear button */}
        {search.query && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-10 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            aria-label="Clear search"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        {/* Keyboard shortcut hint */}
        {isFocused && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">
            ⌘K
          </span>
        )}
      </div>

      {/* Suggestion dropdown */}
      {showDropdown && (
        <div
          ref={dropdownRef}
          id="search-suggestions"
          role="listbox"
          className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto"
        >
          {search.suggestions.map((suggestion, index) => (
            <button
              key={suggestion}
              id={`suggestion-${index}`}
              role="option"
              aria-selected={index === selectedIndex}
              className={`w-full text-left px-4 py-2 text-sm cursor-pointer ${
                index === selectedIndex
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                navigateToSearch(suggestion);
              }}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
