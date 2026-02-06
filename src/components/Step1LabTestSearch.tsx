import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Loader2, AlertCircle, ArrowUpDown, ArrowUp, ArrowDown, PackageCheck, Filter, ShoppingCart, ExternalLink } from 'lucide-react';
import { searchLabTests } from '../lib/api';
import type { LabTestSearchResult, CartItem } from '../lib/types';

// Import rollup files
import scaleRollup from '../../SQL_Files/lab_attribute_rollups/rollup_scale_type.json';
import systemRollup from '../../SQL_Files/lab_attribute_rollups/rollup_system.json';
import termSuggestions from '../../SQL_Files/termsuggest.json';
// Note: timeRollup not needed - API already does time rollup transformation

type SortField = 'search_result' | 'vocabulary_id' | 'searched_concept_class_id' | 'scale' | 'system' | 'time' | 'panel_count';
type SortDirection = 'asc' | 'desc';

interface Step1LabTestSearchProps {
  addToCart: (item: CartItem) => void;
  removeFromCart: (hierarchyConceptId: number) => void;
  addMultipleToCart: (items: CartItem[]) => void;
  removeMultipleFromCart: (conceptIds: number[]) => void;
  shoppingCart: CartItem[];
  goToPanelStep?: () => void; // Optional: Navigate to Step 2 (Panel Search)
}

export default function Step1LabTestSearch({
  addToCart,
  removeFromCart,
  addMultipleToCart,
  removeMultipleFromCart,
  shoppingCart,
  goToPanelStep,
}: Step1LabTestSearchProps) {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<LabTestSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedVocabularies, setSelectedVocabularies] = useState<Set<string>>(new Set());
  const [selectedLabTestTypes, setSelectedLabTestTypes] = useState<Set<string>>(new Set());
  const [selectedScaleType, setSelectedScaleType] = useState<string>('');
  const [selectedSystemCategory, setSelectedSystemCategory] = useState<string>('');
  const [selectedTimeBucket, setSelectedTimeBucket] = useState<string>('');
  const [textFilter, setTextFilter] = useState<string>('');

  // Sorting
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Autocomplete
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);

  // Filter autocomplete suggestions based on search term
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
    ).slice(0, 10); // Limit to 10 suggestions

    return matches;
  }, [searchTerm]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();

    // Close autocomplete
    setShowSuggestions(false);
    setSelectedSuggestionIndex(-1);

    setLoading(true);
    setError(null);
    setResults([]);
    // Clear all filters
    setSelectedVocabularies(new Set());
    setSelectedLabTestTypes(new Set());
    setSelectedScaleType('');
    setSelectedSystemCategory('');
    setSelectedTimeBucket('');
    setTextFilter('');

    try {
      const data = await searchLabTests({
        searchterm: searchTerm.trim(),
      });

      setResults(data);

      if (data.length === 0) {
        setError('No lab tests found. Try a different search term.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lab test search failed');
    } finally {
      setLoading(false);
    }
  };

  // Handle "Clear Search" button click
  const handleClearSearch = () => {
    setSearchTerm('');
    setResults([]);
    setError(null);
    setSelectedVocabularies(new Set());
    setSelectedLabTestTypes(new Set());
    setSelectedScaleType('');
    setSelectedSystemCategory('');
    setSelectedTimeBucket('');
    setTextFilter('');
    setShowSuggestions(false);
  };

  // Handle autocomplete suggestion selection
  const handleSuggestionSelect = (suggestionText: string) => {
    setSearchTerm(suggestionText);
    setShowSuggestions(false);
    setSelectedSuggestionIndex(-1);
  };

  // Handle keyboard navigation in autocomplete
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

  // Handle "Add to Cart" button click - toggles between add and remove
  const handleAddToCart = (result: LabTestSearchResult) => {
    const conceptId = result.std_concept_id;

    // If already in cart, remove it
    if (isInCart(result)) {
      removeFromCart(conceptId);
      return;
    }

    // Otherwise, add to cart
    const cartItem: CartItem = {
      hierarchy_concept_id: conceptId,
      concept_name: result.search_result,
      vocabulary_id: result.vocabulary_id,
      concept_class_id: result.searched_concept_class_id,
      root_term: result.search_result,
      domain_id: 'Measurement',
    };
    addToCart(cartItem);
  };

  // Check if item is already in cart
  const isInCart = (result: LabTestSearchResult) => {
    return shoppingCart.some((item) => item.hierarchy_concept_id === result.std_concept_id);
  };

  // Create lookup maps from rollup data
  const scaleToLabel = useMemo(() => {
    const map = new Map<string, string>();
    scaleRollup.forEach((item: any) => {
      map.set(item.raw_value, item.label);
    });
    return map;
  }, []);

  const systemToCategory = useMemo(() => {
    const map = new Map<string, string>();
    systemRollup.forEach((item: any) => {
      map.set(item.raw_value, item.system_category);
    });
    return map;
  }, []);

  // Note: Time values are already rolled up by the API
  // API transforms "1 hour" → "Short duration", so r.time is already the bucket value

  // Get unique values with rollup grouping
  const availableVocabularies = useMemo(() =>
    Array.from(new Set(results.map((r) => r.vocabulary_id))).sort(),
    [results]
  );

  const availableLabTestTypes = useMemo(() =>
    Array.from(new Set(results.map((r) => r.lab_test_type))).sort(),
    [results]
  );

  // Cascading filters: Filter results by vocabulary first, then calculate available options
  const vocabularyFilteredResults = useMemo(() => {
    if (selectedVocabularies.size === 0) {
      return results;
    }
    return results.filter((r) => selectedVocabularies.has(r.vocabulary_id));
  }, [results, selectedVocabularies]);

  const availableScaleLabels = useMemo(() => {
    const scales = new Map<string, Set<string>>();
    vocabularyFilteredResults.forEach((r) => {
      if (r.scale) {
        const label = scaleToLabel.get(r.scale) || r.scale;
        if (!scales.has(label)) {
          scales.set(label, new Set());
        }
        scales.get(label)!.add(r.scale);
      }
    });
    return scales;
  }, [vocabularyFilteredResults, scaleToLabel]);

  const availableSystemCategories = useMemo(() => {
    const categories = new Map<string, Set<string>>();
    vocabularyFilteredResults.forEach((r) => {
      if (r.system) {
        const category = systemToCategory.get(r.system) || 'Unknown / Other';
        if (!categories.has(category)) {
          categories.set(category, new Set());
        }
        categories.get(category)!.add(r.system);
      }
    });
    return categories;
  }, [vocabularyFilteredResults, systemToCategory]);

  const availableTimeBuckets = useMemo(() => {
    const buckets = new Map<string, Set<string>>();
    vocabularyFilteredResults.forEach((r) => {
      if (r.time) {
        // r.time is already the rolled-up bucket value from the API
        const bucket = r.time;
        if (!buckets.has(bucket)) {
          buckets.set(bucket, new Set());
        }
        buckets.get(bucket)!.add(r.time);
      }
    });
    return buckets;
  }, [vocabularyFilteredResults]);

  // Apply filters
  let filteredResults = results.filter((result) => {
    // Vocabulary filter
    if (selectedVocabularies.size > 0 && !selectedVocabularies.has(result.vocabulary_id)) {
      return false;
    }

    // Test type filter
    if (selectedLabTestTypes.size > 0 && !selectedLabTestTypes.has(result.lab_test_type)) {
      return false;
    }

    // Scale label filter
    if (selectedScaleType && result.scale) {
      const label = scaleToLabel.get(result.scale) || result.scale;
      if (selectedScaleType !== label) {
        return false;
      }
    } else if (selectedScaleType && !result.scale) {
      return false;
    }

    // System category filter
    if (selectedSystemCategory && result.system) {
      const category = systemToCategory.get(result.system) || 'Unknown / Other';
      if (selectedSystemCategory !== category) {
        return false;
      }
    } else if (selectedSystemCategory && !result.system) {
      return false;
    }

    // Time bucket filter
    if (selectedTimeBucket && result.time) {
      // result.time is already the rolled-up bucket value from the API
      if (selectedTimeBucket !== result.time) {
        return false;
      }
    } else if (selectedTimeBucket && !result.time) {
      return false;
    }

    // Text filter
    if (textFilter && !result.search_result.toLowerCase().includes(textFilter.toLowerCase())) {
      return false;
    }

    return true;
  });

  // Apply sorting
  const vocabularyPriority: { [key: string]: number } = {
    'LOINC': 1,
    'CPT4': 2,
    'HCPCS': 3,
    'SNOMED': 4,
  };

  filteredResults = [...filteredResults].sort((a, b) => {
    // If user has selected a column to sort by, use that
    if (sortField) {
      let aVal = a[sortField];
      let bVal = b[sortField];

      // Handle null values
      if (aVal === null) aVal = '';
      if (bVal === null) bVal = '';

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }

      return 0;
    }

    // Default sort: vocabulary_id (LOINC > CPT4 > HCPCS > SNOMED) then std_concept_id
    const vocabA = vocabularyPriority[a.vocabulary_id] || 999;
    const vocabB = vocabularyPriority[b.vocabulary_id] || 999;

    if (vocabA !== vocabB) {
      return vocabA - vocabB;
    }

    // If same vocabulary, sort by std_concept_id
    return a.std_concept_id - b.std_concept_id;
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 inline ml-1 text-gray-400" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="w-3 h-3 inline ml-1 text-primary-600" />
    ) : (
      <ArrowDown className="w-3 h-3 inline ml-1 text-primary-600" />
    );
  };

  // Count how many filtered results are in cart
  const filteredInCartCount = filteredResults.filter((r) => isInCart(r)).length;

  // Add/Remove all filtered items
  const handleAddAllFiltered = () => {
    const itemsToAdd = filteredResults
      .filter((r) => !isInCart(r))
      .map((r) => ({
        hierarchy_concept_id: r.std_concept_id,
        concept_name: r.search_result,
        vocabulary_id: r.vocabulary_id,
        concept_class_id: r.searched_concept_class_id,
        root_term: r.search_result,
        domain_id: 'Measurement' as const,
      }));

    if (itemsToAdd.length > 0) {
      addMultipleToCart(itemsToAdd);
    }
  };

  const handleRemoveAllFiltered = () => {
    const conceptIds = filteredResults
      .filter((r) => isInCart(r))
      .map((r) => r.std_concept_id);

    if (conceptIds.length > 0) {
      removeMultipleFromCart(conceptIds);
    }
  };

  // Toggle pill selection with cascading clear
  const togglePill = (set: Set<string>, value: string, setter: (s: Set<string>) => void) => {
    const newSet = new Set(set);
    if (newSet.has(value)) {
      newSet.delete(value);
    } else {
      newSet.add(value);
    }
    setter(newSet);

    // Clear dependent filters when vocabulary changes
    if (setter === setSelectedVocabularies) {
      // Check if selected scale/system/time are still available after vocabulary change
      const newVocabFiltered = results.filter((r) =>
        newSet.size === 0 || newSet.has(r.vocabulary_id)
      );

      // Clear scale if not available
      if (selectedScaleType) {
        const stillAvailable = newVocabFiltered.some((r) => {
          const label = scaleToLabel.get(r.scale || '') || r.scale;
          return label === selectedScaleType;
        });
        if (!stillAvailable) setSelectedScaleType('');
      }

      // Clear system if not available
      if (selectedSystemCategory) {
        const stillAvailable = newVocabFiltered.some((r) => {
          const category = systemToCategory.get(r.system || '') || 'Unknown / Other';
          return category === selectedSystemCategory;
        });
        if (!stillAvailable) setSelectedSystemCategory('');
      }

      // Clear time if not available
      if (selectedTimeBucket) {
        const stillAvailable = newVocabFiltered.some((r) => {
          // r.time is already the rolled-up bucket value from the API
          return r.time === selectedTimeBucket;
        });
        if (!stillAvailable) setSelectedTimeBucket('');
      }
    }
  };

  // Clear all filters
  const clearAllFilters = () => {
    setSelectedVocabularies(new Set());
    setSelectedLabTestTypes(new Set());
    setSelectedScaleType('');
    setSelectedSystemCategory('');
    setSelectedTimeBucket('');
    setTextFilter('');
  };

  const hasActiveFilters = selectedVocabularies.size > 0 ||
    selectedLabTestTypes.size > 0 ||
    selectedScaleType.length > 0 ||
    selectedSystemCategory.length > 0 ||
    selectedTimeBucket.length > 0 ||
    textFilter.length > 0;

  return (
    <div className="space-y-4">
      {/* Search Form */}
      <div className="card p-4">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="flex-1 relative">
            <input
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
                // Delay to allow click on suggestion
                setTimeout(() => setShowSuggestions(false), 200);
              }}
              placeholder="Search lab tests (e.g., glucose, hemoglobin, cholesterol)..."
              className="input-field w-full"
              disabled={loading}
              autoComplete="off"
            />

            {/* Autocomplete Dropdown */}
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
          <button type="submit" className="btn-primary flex items-center gap-2" disabled={loading}>
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
          <button
            type="button"
            onClick={handleClearSearch}
            className="btn-secondary flex items-center gap-2"
            disabled={loading || (searchTerm === '' && results.length === 0)}
          >
            Clear Search
          </button>
        </form>
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <>
          {/* Filters */}
          <div className="card p-4 bg-primary-50 border-primary-200">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-primary-600" />
                <h3 className="text-sm font-semibold text-gray-900">
                  Results: {filteredResults.length}
                  {filteredResults.length !== results.length && ` of ${results.length}`}
                </h3>
              </div>
              {hasActiveFilters && (
                <button
                  onClick={clearAllFilters}
                  className="text-xs text-primary-600 hover:text-primary-700 font-medium"
                >
                  Clear All Filters
                </button>
              )}
            </div>

            <div className="space-y-2">
              {/* Row 1: Name Filter + Test Type + Vocabulary Pills */}
              <div className="flex items-center gap-2">
                {/* Name Filter (Narrow) */}
                <div className="w-40">
                  <input
                    type="text"
                    id="textFilter"
                    value={textFilter}
                    onChange={(e) => setTextFilter(e.target.value)}
                    placeholder="Filter by name..."
                    className="input-field text-xs w-full"
                  />
                </div>

                {/* Test Type Dropdown (Compact) */}
                {availableLabTestTypes.length > 0 && (
                  <div className="w-32">
                    <select
                      value={Array.from(selectedLabTestTypes)[0] || ''}
                      onChange={(e) => {
                        if (e.target.value) {
                          setSelectedLabTestTypes(new Set([e.target.value]));
                        } else {
                          setSelectedLabTestTypes(new Set());
                        }
                      }}
                      className="input-field text-xs w-full"
                    >
                      <option value="">All Types</option>
                      {availableLabTestTypes.map((type) => {
                        const count = results.filter((r) => r.lab_test_type === type).length;
                        return (
                          <option key={type} value={type}>
                            {type} ({count})
                          </option>
                        );
                      })}
                    </select>
                  </div>
                )}

                {/* Vocabulary Pills */}
                {availableVocabularies.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    {availableVocabularies.map((vocab) => {
                      const count = results.filter((r) => r.vocabulary_id === vocab).length;
                      const isSelected = selectedVocabularies.has(vocab);
                      return (
                        <button
                          key={vocab}
                          onClick={() => togglePill(selectedVocabularies, vocab, setSelectedVocabularies)}
                          className={`
                            px-2 py-1 rounded border text-xs font-medium transition-colors
                            ${
                              isSelected
                                ? 'bg-primary-600 border-primary-600 text-white'
                                : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                            }
                          `}
                        >
                          {vocab} ({count})
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Row 2: Lab Attribute Dropdowns */}
              <div className="flex items-center gap-2">
                {/* Scale Dropdown */}
                <div className="w-36">
                  <select
                    value={selectedScaleType}
                    onChange={(e) => setSelectedScaleType(e.target.value)}
                    className="input-field text-xs w-full"
                  >
                    <option value="">All Scales</option>
                    {Array.from(availableScaleLabels.keys()).sort().map((label) => {
                      const scales = availableScaleLabels.get(label)!;
                      const count = vocabularyFilteredResults.filter((r) => r.scale && scales.has(r.scale)).length;
                      return (
                        <option key={label} value={label}>
                          {label} ({count})
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* System Dropdown */}
                <div className="w-40">
                  <select
                    value={selectedSystemCategory}
                    onChange={(e) => setSelectedSystemCategory(e.target.value)}
                    className="input-field text-xs w-full"
                  >
                    <option value="">All Systems</option>
                    {Array.from(availableSystemCategories.keys()).sort().map((category) => {
                      const systems = availableSystemCategories.get(category)!;
                      const count = vocabularyFilteredResults.filter((r) => r.system && systems.has(r.system)).length;
                      return (
                        <option key={category} value={category}>
                          {category} ({count})
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* Time Dropdown */}
                <div className="w-40">
                  <select
                    value={selectedTimeBucket}
                    onChange={(e) => setSelectedTimeBucket(e.target.value)}
                    className="input-field text-xs w-full"
                  >
                    <option value="">All Time Aspects</option>
                    {Array.from(availableTimeBuckets.keys()).sort().map((bucket) => {
                      const times = availableTimeBuckets.get(bucket)!;
                      const count = vocabularyFilteredResults.filter((r) => r.time && times.has(r.time)).length;
                      return (
                        <option key={bucket} value={bucket}>
                          {bucket} ({count})
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-primary-200 flex items-center justify-between text-xs">
              <span className="text-gray-700">
                {filteredInCartCount > 0 && `${filteredInCartCount} in cart`}
              </span>
              <div className="flex gap-2 items-center">
                <button
                  onClick={handleAddAllFiltered}
                  disabled={filteredResults.length === 0 || filteredResults.every(r => isInCart(r))}
                  className="text-primary-600 hover:text-primary-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Add All Filtered
                </button>
                <span className="text-gray-300">|</span>
                <button
                  onClick={handleRemoveAllFiltered}
                  disabled={filteredInCartCount === 0}
                  className="text-red-600 hover:text-red-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Remove All Filtered
                </button>
                {shoppingCart.length > 0 && (
                  <>
                    <span className="text-gray-300">|</span>
                    {goToPanelStep && (
                      <button
                        onClick={goToPanelStep}
                        className="bg-green-600 hover:bg-green-700 text-white flex items-center gap-1.5 text-xs px-3 py-1.5 rounded transition-colors"
                      >
                        <ShoppingCart className="w-3 h-3" />
                        Add Panels
                      </button>
                    )}
                    {goToPanelStep && <span className="text-gray-300">|</span>}
                    <button
                      onClick={() => navigate('/codeset')}
                      className="btn-primary flex items-center gap-1.5 text-xs px-3 py-1.5"
                    >
                      <PackageCheck className="w-3 h-3" />
                      Build ({shoppingCart.length})
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Results Table */}
          <div className="card p-0">
            <div className="overflow-x-auto">
              <table className="table compact-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                <thead>
                  <tr>
                    <th className="w-[35%] text-xs py-2 cursor-pointer hover:bg-gray-50" onClick={() => handleSort('search_result')}>
                      Lab Test Name {getSortIcon('search_result')}
                    </th>
                    <th className="w-[10%] text-xs py-2">Code</th>
                    <th className="w-[10%] text-xs py-2 cursor-pointer hover:bg-gray-50" onClick={() => handleSort('vocabulary_id')}>
                      Vocabulary {getSortIcon('vocabulary_id')}
                    </th>
                    <th className="w-[10%] text-xs py-2 cursor-pointer hover:bg-gray-50" onClick={() => handleSort('scale')}>
                      Scale {getSortIcon('scale')}
                    </th>
                    <th className="w-[12%] text-xs py-2 cursor-pointer hover:bg-gray-50" onClick={() => handleSort('system')}>
                      System {getSortIcon('system')}
                    </th>
                    <th className="w-[12%] text-xs py-2 cursor-pointer hover:bg-gray-50" onClick={() => handleSort('time')}>
                      Time {getSortIcon('time')}
                    </th>
                    <th className="w-[6%] text-xs py-2 cursor-pointer hover:bg-gray-50" onClick={() => handleSort('panel_count')}>
                      In Panels {getSortIcon('panel_count')}
                    </th>
                    <th className="w-[5%] text-xs py-2">Action</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredResults.map((result) => (
                    <tr key={result.std_concept_id} className="hover:bg-gray-50">
                      <td className="py-2 px-2 font-medium text-sm">
                        <div className="flex items-center gap-1">
                          <span className="truncate" title={result.search_result}>
                            {result.search_result}
                          </span>
                          <a
                            href={`https://athena.ohdsi.org/search-terms/terms/${result.std_concept_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary-600 hover:text-primary-700 flex-shrink-0"
                            title="View code in Athena."
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      </td>
                      <td className="py-2 px-2 font-mono text-xs">
                        <div className="truncate" title={result.searched_code}>{result.searched_code}</div>
                      </td>
                      <td className="py-2 px-2">
                        <span className="badge badge-primary text-xs px-2 py-0.5">
                          {result.vocabulary_id}
                        </span>
                      </td>
                      <td className="py-2 px-1 text-xs text-gray-600">
                        <div className="truncate" title={result.scale || undefined}>{result.scale || '-'}</div>
                      </td>
                      <td className="py-2 px-1 text-xs text-gray-600">
                        <div className="truncate" title={result.system || undefined}>{result.system || '-'}</div>
                      </td>
                      <td className="py-2 px-1 text-xs text-gray-600">
                        <div className="truncate" title={result.time || undefined}>{result.time || '-'}</div>
                      </td>
                      <td className="py-2 px-2 text-center">
                        {result.panel_count > 0 ? (
                          <span className="inline-flex items-center justify-center bg-blue-100 text-blue-800 text-xs font-medium px-2 py-0.5 rounded">
                            {result.panel_count}
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="py-2 px-2">
                        <button
                          onClick={() => handleAddToCart(result)}
                          className={`text-xs px-2 py-1 whitespace-nowrap flex items-center gap-1 ${
                            isInCart(result)
                              ? 'bg-blue-600 text-white hover:bg-blue-700 cursor-pointer'
                              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                          }`}
                          title={isInCart(result) ? 'Click to remove from cart' : 'Add to cart'}
                        >
                          <ShoppingCart className="w-3 h-3" />
                          {isInCart(result) ? 'In Cart' : 'Add'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </>
      )}
    </div>
  );
}
