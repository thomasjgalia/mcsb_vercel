import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Loader2, AlertCircle, ArrowUpDown, ArrowUp, ArrowDown, ShoppingCart, GitBranch, PackageCheck } from 'lucide-react';
import { searchConcepts, trackSearch } from '../lib/api';
import { supabase } from '../lib/supabase';
import type { DomainType, SearchResult, CartItem } from '../lib/types';
import termSuggestions from '../../SQL_Files/termsuggest.json';

type SortField = 'standard_name' | 'standard_vocabulary' | 'concept_class_id' | 'search_result' | 'searched_code' | 'searched_vocabulary';
type SortDirection = 'asc' | 'desc';

interface Step1SearchProps {
  onConceptSelected: (concept: SearchResult, domain: DomainType) => void;
  currentStep: number;
  workflow: 'direct' | 'hierarchical' | 'labtest';
  searchResults: SearchResult[];
  setSearchResults: (results: SearchResult[]) => void;
  lastSearchTerm: string;
  setLastSearchTerm: (term: string) => void;
  lastSearchDomain: DomainType | '';
  setLastSearchDomain: (domain: DomainType | '') => void;
  addToCart: (item: CartItem) => void;
  removeFromCart: (hierarchyConceptId: number) => void;
  addMultipleToCart: (items: CartItem[]) => void;
  removeMultipleFromCart: (conceptIds: number[]) => void;
  shoppingCart: CartItem[];
}

const DOMAINS: DomainType[] = ['Condition', 'Drug', 'Procedure', 'Measurement', 'Observation', 'Device'];

export default function Step1Search({
  onConceptSelected,
  workflow,
  searchResults,
  setSearchResults,
  lastSearchTerm,
  setLastSearchTerm,
  lastSearchDomain,
  setLastSearchDomain,
  addToCart,
  removeFromCart,
  addMultipleToCart,
  removeMultipleFromCart,
  shoppingCart,
}: Step1SearchProps) {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState(lastSearchTerm);
  const [domain, setDomain] = useState<DomainType | ''>(lastSearchDomain);
  const [results, setResults] = useState<SearchResult[]>(searchResults);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedVocabularies, setSelectedVocabularies] = useState<Set<string>>(new Set());
  const [selectedConceptClass, setSelectedConceptClass] = useState<string>('');
  const [textFilter, setTextFilter] = useState<string>('');
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);

  // Autocomplete suggestions
  const suggestions = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    if (term.length < 2) {
      return [];
    }

    const allTerms = [
      ...termSuggestions.single_words.map(w => ({ text: w, type: 'word' as const })),
      ...termSuggestions.phrases.map(p => ({ text: p, type: 'phrase' as const })),
      ...termSuggestions.drugs.map(d => ({ text: d, type: 'drug' as const })),
    ];

    const matches = allTerms.filter(item =>
      item.text.toLowerCase().includes(term)
    ).slice(0, 10);

    return matches;
  }, [searchTerm]);

  const handleSuggestionSelect = (suggestionText: string) => {
    setSearchTerm(suggestionText);
    setShowSuggestions(false);
    setSelectedSuggestionIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || suggestions.length === 0) {
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedSuggestionIndex((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedSuggestionIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        if (selectedSuggestionIndex >= 0) {
          e.preventDefault();
          handleSuggestionSelect(suggestions[selectedSuggestionIndex].text);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setShowSuggestions(false);
        setSelectedSuggestionIndex(-1);
        break;
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();

    if (searchTerm.trim().length < 2) {
      setError('Please enter at least 2 characters');
      return;
    }

    if (!domain) {
      setError('Please select a domain');
      return;
    }

    setLoading(true);
    setError(null);
    setResults([]);
    setSelectedVocabularies(new Set());
    setSelectedConceptClass('');

    try {
      const data = await searchConcepts({
        searchterm: searchTerm.trim(),
        domain_id: domain as DomainType,
      });

      setResults(data);
      // Also save to parent state so results persist when navigating back
      setSearchResults(data);
      setLastSearchTerm(searchTerm.trim());
      setLastSearchDomain(domain as DomainType);

      // Track search in history (fire and forget)
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        trackSearch(session.user.id, searchTerm.trim(), domain as DomainType, data.length)
          .catch(() => {
            // Silently fail if tracking errors occur
          });
      }

      if (data.length === 0) {
        setError('No results found. Try a different search term or domain.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  // Handle "See Hierarchy" button click
  const handleSeeHierarchy = (result: SearchResult) => {
    onConceptSelected(result, domain as DomainType);
  };

  // Handle "Add to Cart" button click - toggles between add and remove
  const handleAddToCart = (result: SearchResult) => {
    // For Direct Build: use searched concept ID (the original concept from search)
    // For Hierarchical Build: use standard concept ID (for hierarchy traversal)
    const conceptId = workflow === 'direct' ? result.searched_concept_id : result.std_concept_id;

    // If already in cart, remove it
    if (isInCart(result)) {
      removeFromCart(conceptId);
      return;
    }

    // Otherwise, add to cart
    const conceptName = workflow === 'direct' ? result.search_result : result.standard_name;
    const vocabularyId = workflow === 'direct' ? result.searched_vocabulary : result.standard_vocabulary;
    const conceptClassId = workflow === 'direct' ? result.searched_concept_class_id : result.concept_class_id;

    const cartItem: CartItem = {
      hierarchy_concept_id: conceptId,
      concept_name: conceptName,
      vocabulary_id: vocabularyId,
      concept_class_id: conceptClassId,
      root_term: result.search_result,
      domain_id: domain as DomainType,
    };
    addToCart(cartItem);
  };

  // Helper to get the correct concept ID based on workflow
  const getConceptId = (result: SearchResult) => {
    return workflow === 'direct' ? result.searched_concept_id : result.std_concept_id;
  };

  // Check if item is already in cart
  const isInCart = (result: SearchResult) => {
    const conceptId = getConceptId(result);
    return shoppingCart.some((item) => item.hierarchy_concept_id === conceptId);
  };

  // Handle column sorting
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      // Toggle direction if clicking same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // New column, default to ascending
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Add all filtered results to cart
  const handleAddAllToCart = () => {
    // Collect all items to add
    const itemsToAdd: CartItem[] = filteredResults.map(result => {
      // For Direct Build: use searched concept ID (the original concept from search)
      // For Hierarchical Build: use standard concept ID (for hierarchy traversal)
      const conceptId = getConceptId(result);
      const conceptName = workflow === 'direct' ? result.search_result : result.standard_name;
      const vocabularyId = workflow === 'direct' ? result.searched_vocabulary : result.standard_vocabulary;
      const conceptClassId = workflow === 'direct' ? result.searched_concept_class_id : result.concept_class_id;

      return {
        hierarchy_concept_id: conceptId,
        concept_name: conceptName,
        vocabulary_id: vocabularyId,
        concept_class_id: conceptClassId,
        root_term: result.search_result,
        domain_id: domain as DomainType,
      };
    });

    // Add all items to cart at once (duplicate checking happens in parent)
    addMultipleToCart(itemsToAdd);
  };

  // Check if all filtered results are in cart
  const areAllFilteredInCart = () => {
    if (filteredResults.length === 0) return false;
    return filteredResults.every(result => isInCart(result));
  };

  // Remove all filtered results from cart
  const handleRemoveAllFromCart = () => {
    const conceptIdsToRemove = filteredResults
      .filter(result => isInCart(result))
      .map(result => getConceptId(result));

    if (conceptIdsToRemove.length > 0) {
      removeMultipleFromCart(conceptIdsToRemove);
    }
  };

  // Check if any filtered results are in cart
  const areAnyFilteredInCart = () => {
    if (filteredResults.length === 0) return false;
    return filteredResults.some(result => isInCart(result));
  };

  // Get unique vocabularies and concept classes from results
  const availableVocabularies = Array.from(
    new Set(results.map((r) => r.searched_vocabulary))
  ).sort();

  const availableConceptClasses = Array.from(
    new Set(results.map((r) => r.searched_concept_class_id))
  ).sort();

  // Filter results based on selections and text filter
  let filteredResults = results.filter((result) => {
    if (selectedVocabularies.size > 0 && !selectedVocabularies.has(result.searched_vocabulary)) {
      return false;
    }
    if (selectedConceptClass && result.searched_concept_class_id !== selectedConceptClass) {
      return false;
    }
    if (textFilter && textFilter.length >= 2) {
      const searchText = textFilter.toLowerCase();
      const matchesSearched = result.searched_term?.toLowerCase().includes(searchText);
      const matchesStandard = result.standard_name?.toLowerCase().includes(searchText);
      const matchesCode = result.standard_code?.toLowerCase().includes(searchText);
      if (!matchesSearched && !matchesStandard && !matchesCode) {
        return false;
      }
    }
    return true;
  });

  // Apply sorting
  if (sortField) {
    filteredResults = [...filteredResults].sort((a, b) => {
      const aValue = a[sortField] || '';
      const bValue = b[sortField] || '';

      const comparison = aValue.toString().localeCompare(bValue.toString(), undefined, {
        numeric: true,
        sensitivity: 'base'
      });

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }

  // Clear all filters
  const clearFilters = () => {
    setSelectedVocabularies(new Set());
    setSelectedConceptClass('');
    setTextFilter('');
    setSortField(null);
    setSortDirection('asc');
  };

  // Clear entire search
  const clearSearch = () => {
    setSearchTerm('');
    setDomain('');
    setResults([]);
    setSearchResults([]);
    setLastSearchTerm('');
    setLastSearchDomain('');
    setSelectedVocabularies(new Set());
    setSelectedConceptClass('');
    setTextFilter('');
    setSortField(null);
    setSortDirection('asc');
    setError(null);
  };

  return (
    <div className="space-y-4">
      {/* Compact Search Form */}
      <form onSubmit={handleSearch} className="card p-3">
        <div className="flex items-end gap-3">
          {/* Search Term */}
          <div className="flex-1">
            <label htmlFor="searchTerm" className="block text-xs font-medium text-gray-700 mb-1">
              Search medical concepts
            </label>
            <div className="relative">
              <input
                id="searchTerm"
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setShowSuggestions(true);
                  setSelectedSuggestionIndex(-1);
                }}
                onKeyDown={handleKeyDown}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => {
                  setTimeout(() => setShowSuggestions(false), 200);
                }}
                placeholder="e.g., ritonavir, diabetes"
                className="input-field text-sm"
                disabled={loading}
                required
                minLength={2}
                autoComplete="off"
              />

              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                  {suggestions.map((suggestion, index) => (
                    <div
                      key={`${suggestion.type}-${suggestion.text}`}
                      onClick={() => handleSuggestionSelect(suggestion.text)}
                      className={`px-4 py-2 cursor-pointer flex items-center gap-2 ${
                        index === selectedSuggestionIndex
                          ? 'bg-primary-100'
                          : 'hover:bg-gray-50'
                      }`}
                    >
                      <span className="flex-1 text-sm text-gray-900">
                        {suggestion.text}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          suggestion.type === 'phrase'
                            ? 'bg-blue-100 text-blue-700'
                            : suggestion.type === 'drug'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {suggestion.type}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Domain */}
          <div className="w-48">
            <label htmlFor="domain" className="block text-xs font-medium text-gray-700 mb-1">
              Domain <span className="text-red-600">*</span>
            </label>
            <select
              id="domain"
              value={domain}
              onChange={(e) => setDomain(e.target.value as DomainType | '')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && domain && searchTerm.trim().length >= 2) {
                  e.preventDefault();
                  const form = e.currentTarget.closest('form');
                  if (form) {
                    form.requestSubmit();
                  }
                }
              }}
              className="select-field text-sm"
              disabled={loading}
              required
            >
              <option value="">Select...</option>
              {DOMAINS.map((d) => {
                // Hierarchical domains: Condition, Drug
                // Direct build domains: Procedure, Measurement, Observation, Device
                const isHierarchicalDomain = d === 'Condition' || d === 'Drug';
                const isEmphasized = workflow === 'hierarchical' ? isHierarchicalDomain : !isHierarchicalDomain;

                return (
                  <option
                    key={d}
                    value={d}
                    style={{
                      fontWeight: isEmphasized ? 'bold' : 'normal',
                      color: isEmphasized ? '#111827' : '#9CA3AF'
                    }}
                  >
                    {d}
                  </option>
                );
              })}
            </select>
          </div>

          <button
            type="submit"
            disabled={loading || searchTerm.trim().length < 2 || !domain}
            className="btn-primary flex items-center gap-2 text-sm px-4 py-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Searching...
              </>
            ) : (
              <>
                <Search className="w-4 h-4" />
                Search
              </>
            )}
          </button>

          {/* Clear Search Button */}
          {results.length > 0 && (
            <button
              type="button"
              onClick={clearSearch}
              className="btn-secondary text-sm px-4 py-2 whitespace-nowrap"
            >
              Clear Search
            </button>
          )}
        </div>
      </form>

      {/* Domain-Specific Helper Text */}
      {domain && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-blue-900">
              {(domain === 'Condition' || domain === 'Drug') ? (
                <p>
                  Code Sets for Condition and Drug domains effectively leverage the hierarchical nature of the vocabularies. Choose a concept that most closely resembles your search term and click the view hierarchy button.
                </p>
              ) : (
                <p>
                  For code sets within Procedure, Measurement, Observation and Device domains, a good approach is to filter on your vocabulary and key terms and then use the Add or Add All button to add the terms to the shopping cart.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-800">{error}</p>
        </div>
      )}

      {/* Results Table */}
      {results.length > 0 && (
        <div className="card p-4">
          {/* Secondary Filter Controls - Highlighted Box */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-3 flex-1">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-semibold text-gray-900 whitespace-nowrap">
                    Results: {filteredResults.length}{filteredResults.length !== results.length && ` / ${results.length}`}
                  </h3>

                  {/* Inline Filters */}
                  {results.length > 1 && (
                    <>
                      {/* Text Filter */}
                      <input
                        type="text"
                        value={textFilter}
                        onChange={(e) => setTextFilter(e.target.value)}
                        placeholder="Filter by name (2+ chars)..."
                        className="input-field text-xs py-1 px-2 w-48"
                        title="Auto-filters after 2 characters"
                      />

                      {(selectedVocabularies.size > 0 || selectedConceptClass || textFilter || sortField) && (
                        <button
                          onClick={clearFilters}
                          className="text-xs text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap"
                        >
                          Clear All Filters
                        </button>
                      )}
                    </>
                  )}
                </div>

                {/* Vocabulary Filter Pills and Class Dropdown on same line */}
                {results.length > 1 && (
                  <div className="flex items-center gap-4 flex-wrap">
                    {/* Vocabulary Pills */}
                    {availableVocabularies.length > 1 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium text-gray-700">Vocabulary:</span>
                        <button
                          onClick={() => setSelectedVocabularies(new Set())}
                          className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                            selectedVocabularies.size === 0
                              ? 'bg-primary-600 text-white'
                              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          All ({results.length})
                        </button>
                        {availableVocabularies.map((vocab) => {
                          const count = results.filter((r) => r.searched_vocabulary === vocab).length;
                          const isSelected = selectedVocabularies.has(vocab);
                          return (
                            <button
                              key={vocab}
                              onClick={() => {
                                const newSet = new Set(selectedVocabularies);
                                if (isSelected) {
                                  newSet.delete(vocab);
                                } else {
                                  newSet.add(vocab);
                                }
                                setSelectedVocabularies(newSet);
                              }}
                              className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                                isSelected
                                  ? 'bg-primary-600 text-white'
                                  : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                              }`}
                            >
                              {vocab} ({count})
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Class Dropdown */}
                    {availableConceptClasses.length > 1 && (
                      <div className="flex items-center gap-2">
                        <label htmlFor="classFilter" className="text-xs font-medium text-gray-700">
                          Class:
                        </label>
                        <select
                          id="classFilter"
                          value={selectedConceptClass}
                          onChange={(e) => setSelectedConceptClass(e.target.value)}
                          className="text-xs px-3 py-1.5 rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                        >
                          <option value="">All Classes ({availableConceptClasses.length})</option>
                          {availableConceptClasses.map((conceptClass) => {
                            const count = results.filter((r) => r.searched_concept_class_id === conceptClass).length;
                            return (
                              <option key={conceptClass} value={conceptClass}>
                                {conceptClass} ({count})
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Add All / Remove All / Go to Build buttons on the right */}
              {results.length > 1 && (
                <div className="flex flex-col gap-2 self-start">
                  <div className="flex gap-2">
                    <button
                      onClick={handleAddAllToCart}
                      disabled={areAllFilteredInCart()}
                      className={`text-xs px-3 py-1 whitespace-nowrap flex items-center gap-1 ${
                        areAllFilteredInCart()
                          ? 'bg-blue-600 text-white cursor-not-allowed opacity-75'
                          : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                      }`}
                      title={areAllFilteredInCart() ? 'All filtered results in cart' : 'Add all filtered results to cart'}
                    >
                      <ShoppingCart className="w-3 h-3" />
                      {areAllFilteredInCart() ? 'All In Cart' : `Add All (${filteredResults.length})`}
                    </button>

                    {areAnyFilteredInCart() && (
                      <button
                        onClick={handleRemoveAllFromCart}
                        className="text-xs px-3 py-1 whitespace-nowrap flex items-center gap-1 bg-white text-red-600 border border-red-300 hover:bg-red-50"
                        title="Remove all filtered results from cart"
                      >
                        <ShoppingCart className="w-3 h-3" />
                        Remove All
                      </button>
                    )}
                  </div>

                  {/* Go to Build button - shows when cart has items */}
                  {shoppingCart.length > 0 && (
                    <button
                      onClick={() => navigate('/codeset', { state: { buildType: workflow === 'direct' ? 'direct' : 'hierarchical' } })}
                      className="btn-primary text-xs px-3 py-1.5 whitespace-nowrap flex items-center gap-1 justify-center"
                      title="Go to build code set"
                    >
                      <PackageCheck className="w-3 h-3" />
                      Go to Build ({shoppingCart.length})
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="table-container">
            <table className="table search-results-table text-xs" style={{ tableLayout: 'fixed', width: '100%' }}>
              <thead>
                <tr>
                  {/* Direct Build: Code, Searched Vocab, Searched Result, Class */}
                  {/* Hierarchical Build: Standard Name, Std Vocab, Class, Search Result, Code, Searched Vocab */}

                  {workflow === 'direct' ? (
                    <>
                      <th
                        onClick={() => handleSort('searched_code')}
                        className="cursor-pointer hover:bg-gray-100 select-none text-xs py-2"
                        style={{ width: '8%' }}
                        title="Click to sort"
                      >
                        <div className="flex items-center gap-1">
                          Code
                          {sortField === 'searched_code' ? (
                            sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th
                        onClick={() => handleSort('searched_vocabulary')}
                        className="cursor-pointer hover:bg-gray-100 select-none text-xs py-2"
                        style={{ width: '10%' }}
                        title="Click to sort"
                      >
                        <div className="flex items-center gap-1">
                          Searched Vocab
                          {sortField === 'searched_vocabulary' ? (
                            sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th
                        onClick={() => handleSort('search_result')}
                        className="cursor-pointer hover:bg-gray-100 select-none text-xs py-2"
                        style={{ width: '60%' }}
                        title="Click to sort"
                      >
                        <div className="flex items-center gap-1">
                          Searched Result
                          {sortField === 'search_result' ? (
                            sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th
                        onClick={() => handleSort('concept_class_id')}
                        className="cursor-pointer hover:bg-gray-100 select-none text-xs py-2"
                        style={{ width: '10%' }}
                        title="Click to sort"
                      >
                        <div className="flex items-center gap-1">
                          Class
                          {sortField === 'concept_class_id' ? (
                            sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                    </>
                  ) : (
                    <>
                      <th
                        onClick={() => handleSort('standard_name')}
                        className="cursor-pointer hover:bg-gray-100 select-none text-xs py-2 w-[22%]"
                        title="Click to sort"
                      >
                        <div className="flex items-center gap-1">
                          Standard Name
                          {sortField === 'standard_name' ? (
                            sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th
                        onClick={() => handleSort('standard_vocabulary')}
                        className="cursor-pointer hover:bg-gray-100 select-none text-xs py-2 w-[9%]"
                        title="Click to sort"
                      >
                        <div className="flex items-center gap-1">
                          Std Vocab
                          {sortField === 'standard_vocabulary' ? (
                            sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th
                        onClick={() => handleSort('concept_class_id')}
                        className="cursor-pointer hover:bg-gray-100 select-none text-xs py-2 w-[11%]"
                        title="Click to sort"
                      >
                        <div className="flex items-center gap-1">
                          Class
                          {sortField === 'concept_class_id' ? (
                            sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th
                        onClick={() => handleSort('search_result')}
                        className="cursor-pointer hover:bg-gray-100 select-none text-xs py-2 w-[30%]"
                        title="Click to sort"
                      >
                        <div className="flex items-center gap-1">
                          Search Result
                          {sortField === 'search_result' ? (
                            sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th
                        onClick={() => handleSort('searched_code')}
                        className="cursor-pointer hover:bg-gray-100 select-none text-xs py-2 w-[6%]"
                        title="Click to sort"
                      >
                        <div className="flex items-center gap-1">
                          Code
                          {sortField === 'searched_code' ? (
                            sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                      <th
                        onClick={() => handleSort('searched_vocabulary')}
                        className="cursor-pointer hover:bg-gray-100 select-none text-xs py-2 w-[9%]"
                        title="Click to sort"
                      >
                        <div className="flex items-center gap-1">
                          Searched Vocab
                          {sortField === 'searched_vocabulary' ? (
                            sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-30" />
                          )}
                        </div>
                      </th>
                    </>
                  )}
                  <th className="text-center text-xs py-2" style={{ width: '12%' }}>Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredResults.map((result, index) => (
                  <tr key={`${result.std_concept_id}-${index}`} className="text-xs">
                    {workflow === 'direct' ? (
                      <>
                        <td className="font-mono py-1.5">{result.searched_code}</td>
                        <td className="py-1.5">
                          <span className="badge badge-info text-xs">{result.searched_vocabulary}</span>
                        </td>
                        <td className="text-gray-700 py-1.5">{result.search_result}</td>
                        <td className="text-gray-600 py-1.5">{result.searched_concept_class_id}</td>
                      </>
                    ) : (
                      <>
                        <td className="font-medium py-1.5">{result.standard_name || '-'}</td>
                        <td className="py-1.5">
                          <span className="badge badge-primary text-xs">{result.standard_vocabulary}</span>
                        </td>
                        <td className="text-gray-600 py-1.5">{result.concept_class_id}</td>
                        <td className="text-gray-700 py-1.5">{result.search_result}</td>
                        <td className="font-mono py-1.5">{result.searched_code}</td>
                        <td className="py-1.5">
                          <span className="badge badge-info text-xs">{result.searched_vocabulary}</span>
                        </td>
                      </>
                    )}
                    <td className="py-1.5">
                      <div className="flex items-center justify-center gap-1.5">
                        {workflow === 'hierarchical' && (
                          <button
                            onClick={() => handleSeeHierarchy(result)}
                            className="btn-secondary text-xs px-2 py-1 whitespace-nowrap flex items-center gap-1"
                            title="View hierarchy and descendants"
                          >
                            <GitBranch className="w-3 h-3" />
                            Hierarchy
                          </button>
                        )}
                        <button
                          onClick={() => handleAddToCart(result)}
                          className={`text-xs px-2 py-1 whitespace-nowrap flex items-center gap-1 transition-colors ${
                            isInCart(result)
                              ? 'bg-blue-600 text-white hover:bg-blue-700 cursor-pointer'
                              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                          }`}
                          title={isInCart(result) ? 'Click to remove from cart' : 'Add to cart'}
                        >
                          <ShoppingCart className="w-3 h-3" />
                          {isInCart(result) ? 'In Cart' : 'Add'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && results.length === 0 && !error && (
        <div className="card p-8 text-center">
          <Search className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">
            Enter a medical term and select a domain to search
          </p>
        </div>
      )}

      {/* Strategy Modal */}
    </div>
  );
}
