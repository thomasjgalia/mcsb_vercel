import { useState, useEffect, useMemo } from 'react';
import { PackageCheck, Loader2, AlertCircle, Download, Copy, CheckCircle, RotateCcw, ArrowLeft, Plus, ChevronDown, ChevronRight, Save, X } from 'lucide-react';
import { buildCodeSet, exportToTxt, exportToSql, saveCodeSet } from '../lib/api';
import { supabase } from '../lib/supabase';
import SaveCodeSetModal from './SaveCodeSetModal';
import type { CartItem, CodeSetResult, ComboFilter } from '../lib/types';

interface Step3CodeSetProps {
  shoppingCart: CartItem[];
  workflow: 'direct' | 'hierarchical' | 'labtest' | null;
  onBackToHierarchy: () => void;
  onBackToSearch: () => void;
  onSwitchToHierarchical: () => void;
  onSwitchToDirect: () => void;
  onSwitchToLabTest: () => void;
  onClearCart: () => void;
  onStartOver: () => void;
  currentStep: number;
  lastSearchTerm: string;
  lastSearchDomain: string;
}

export default function Step3CodeSet({
  shoppingCart,
  workflow,
  onBackToHierarchy,
  onBackToSearch,
  onSwitchToHierarchical,
  onSwitchToDirect,
  onSwitchToLabTest,
  onClearCart,
  onStartOver,
  lastSearchTerm,
  lastSearchDomain,
}: Step3CodeSetProps) {
  const [results, setResults] = useState<CodeSetResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comboFilter, setComboFilter] = useState<ComboFilter>('ALL');
  const [sqlCopied, setSqlCopied] = useState(false);
  const [hasBuilt, setHasBuilt] = useState(false);
  const [excludedCodes, setExcludedCodes] = useState<Set<string>>(new Set());
  const [collapsedVocabs, setCollapsedVocabs] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [isFiltering, setIsFiltering] = useState(false);
  const [textFilter, setTextFilter] = useState<string>('');

  // Pending filter states (user selections, not yet applied)
  const [pendingVocabularies, setPendingVocabularies] = useState<Set<string>>(new Set());
  const [pendingCombos, setPendingCombos] = useState<Set<string>>(new Set());
  const [pendingDoseForms, setPendingDoseForms] = useState<Set<string>>(new Set());
  const [pendingDfgCategories, setPendingDfgCategories] = useState<Set<string>>(new Set());

  // Active filter states (actually applied to results)
  const [selectedVocabularies, setSelectedVocabularies] = useState<Set<string>>(new Set());
  const [selectedCombos, setSelectedCombos] = useState<Set<string>>(new Set());
  const [selectedDoseForms, setSelectedDoseForms] = useState<Set<string>>(new Set());
  const [selectedDfgCategories, setSelectedDfgCategories] = useState<Set<string>>(new Set());

  // Per-vocabulary display limits
  const [vocabDisplayLimits, setVocabDisplayLimits] = useState<Map<string, number>>(new Map());
  const DEFAULT_DISPLAY_LIMIT = 100;
  // Initialize build type from workflow prop (direct workflow = direct build, hierarchical workflow = hierarchical build, labtest workflow = labtest build)
  const [buildType, setBuildType] = useState<'hierarchical' | 'direct' | 'labtest'>(
    workflow === 'direct' ? 'direct' : workflow === 'labtest' ? 'labtest' : 'hierarchical'
  );

  // Update build type when workflow changes
  useEffect(() => {
    if (workflow) {
      const newBuildType = workflow === 'direct' ? 'direct' : workflow === 'labtest' ? 'labtest' : 'hierarchical';
      setBuildType(newBuildType);
    }
  }, [workflow]);

  // Auto-build when shopping cart is populated (e.g., from editing a saved code set)
  useEffect(() => {
    if (shoppingCart.length > 0 && !hasBuilt && !loading) {
      buildSet();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shoppingCart.length]); // Only run when cart length changes

  const buildSet = async () => {
    if (shoppingCart.length === 0) return;

    setLoading(true);
    setError(null);
    setResults([]);

    try {
      const conceptIds = shoppingCart.map((item) => item.hierarchy_concept_id);
      const data = await buildCodeSet({
        concept_ids: conceptIds,
        combo_filter: comboFilter,
        build_type: buildType,
      });

      setResults(data);
      setHasBuilt(true);

      if (data.length === 0) {
        setError('No codes found for the selected concepts.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to build code set');
    } finally {
      setLoading(false);
    }
  };

  const handleExportTxt = () => {
    exportToTxt(filteredResults);
  };

  const handleCopySql = async () => {
    try {
      await exportToSql(filteredResults);
      setSqlCopied(true);
      setTimeout(() => setSqlCopied(false), 2000);
    } catch (err) {
      setError('Failed to copy SQL to clipboard');
    }
  };

  const handleSaveCodeSet = async (name: string, description: string) => {
    setSaving(true);
    setSaveSuccess(false);

    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.user) {
        throw new Error('Not authenticated');
      }

      // Hybrid approach: For large code sets (>=500), save only anchor concepts
      // For small code sets, save all built concepts
      const LARGE_CODESET_THRESHOLD = 500;
      const isLargeCodeSet = filteredResults.length >= LARGE_CODESET_THRESHOLD;

      const conceptsToSave = isLargeCodeSet
        ? // Large code set: Save only anchor concepts (shopping cart items)
          shoppingCart.map(item => ({
            hierarchy_concept_id: item.hierarchy_concept_id,
            concept_name: item.concept_name,
            vocabulary_id: item.vocabulary_id,
            concept_class_id: item.concept_class_id,
            root_term: item.concept_name, // Root concept is itself
            domain_id: item.domain_id,
          }))
        : // Small code set: Save all built concepts
          filteredResults.map(result => ({
            hierarchy_concept_id: result.child_concept_id,
            concept_name: result.child_name,
            vocabulary_id: result.child_vocabulary_id,
            concept_class_id: result.concept_class_id,
            root_term: result.root_concept_name,
            domain_id: shoppingCart[0]?.domain_id || 'Condition',
          }));

      // Save the code set
      const saveResult = await saveCodeSet(session.user.id, {
        code_set_name: name,
        description: description || `Saved on ${new Date().toLocaleDateString()}`,
        concepts: conceptsToSave,
        total_concepts: filteredResults.length, // Always pass the full built count
        source_type: 'OMOP',
        // Hybrid storage fields for large code sets
        build_type: buildType,
        anchor_concept_ids: shoppingCart.map(item => item.hierarchy_concept_id),
        build_parameters: {
          combo_filter: comboFilter,
          domain_id: lastSearchDomain,
        },
      });

      setSaveSuccess(true);
      setShowSaveModal(false);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      alert(`Failed to save code set: ${errorMessage}`);
    } finally {
      setSaving(false);
    }
  };

  // Memoize available filter options (only recalculate when results change)
  const availableVocabularies = useMemo(() =>
    Array.from(new Set(results.map((r) => r.child_vocabulary_id))).sort(),
    [results]
  );


  const availableCombos = useMemo(() =>
    Array.from(new Set(results.filter((r) => r.combinationyesno).map((r) => r.combinationyesno as string))).sort(),
    [results]
  );

  const availableDoseForms = useMemo(() =>
    Array.from(new Set(results.filter((r) => r.dose_form).map((r) => r.dose_form as string))).sort(),
    [results]
  );

  const availableDfgCategories = useMemo(() =>
    Array.from(new Set(results.filter((r) => r.dfg_name).map((r) => r.dfg_name as string))).sort(),
    [results]
  );

  // Helper function to compare two sets
  const setsEqual = (a: Set<string>, b: Set<string>) => {
    if (a.size !== b.size) return false;
    for (const item of a) {
      if (!b.has(item)) return false;
    }
    return true;
  };

  // Check if there are pending filter changes
  const hasPendingChanges = useMemo(() => {
    return (
      !setsEqual(pendingVocabularies, selectedVocabularies) ||
      !setsEqual(pendingCombos, selectedCombos) ||
      !setsEqual(pendingDoseForms, selectedDoseForms) ||
      !setsEqual(pendingDfgCategories, selectedDfgCategories)
    );
  }, [
    pendingVocabularies, selectedVocabularies,
    pendingCombos, selectedCombos,
    pendingDoseForms, selectedDoseForms,
    pendingDfgCategories, selectedDfgCategories,
  ]);

  // Apply pending filters to active filters
  const applyFilters = () => {
    setIsFiltering(true);

    // Copy pending to active
    setSelectedVocabularies(new Set(pendingVocabularies));
    setSelectedCombos(new Set(pendingCombos));
    setSelectedDoseForms(new Set(pendingDoseForms));
    setSelectedDfgCategories(new Set(pendingDfgCategories));

    // Hide filtering indicator after a delay
    setTimeout(() => setIsFiltering(false), 800);
  };

  // Clear all filters (both pending and active)
  const clearAllFilters = () => {
    setPendingVocabularies(new Set());
    setPendingCombos(new Set());
    setPendingDoseForms(new Set());
    setPendingDfgCategories(new Set());

    setSelectedVocabularies(new Set());
    setSelectedCombos(new Set());
    setSelectedDoseForms(new Set());
    setSelectedDfgCategories(new Set());

    setTextFilter('');
  };


  // Optimized filtering: combine all filters into single pass (memoized)
  const visibleResults = useMemo(() => {
    return results.filter((r) => {
      // Vocabulary filter
      if (selectedVocabularies.size > 0 && !selectedVocabularies.has(r.child_vocabulary_id)) {
        return false;
      }

      // Combo filter
      if (selectedCombos.size > 0 && (!r.combinationyesno || !selectedCombos.has(r.combinationyesno))) {
        return false;
      }

      // Dose form filter
      if (selectedDoseForms.size > 0 && (!r.dose_form || !selectedDoseForms.has(r.dose_form))) {
        return false;
      }

      // DFG category filter
      if (selectedDfgCategories.size > 0 && (!r.dfg_name || !selectedDfgCategories.has(r.dfg_name))) {
        return false;
      }

      // Text filter (min 2 characters)
      if (textFilter && textFilter.length >= 2) {
        const searchText = textFilter.toLowerCase();
        const matchesName = r.child_name?.toLowerCase().includes(searchText);
        const matchesCode = r.child_code?.toLowerCase().includes(searchText);
        const matchesVocab = r.child_vocabulary_id?.toLowerCase().includes(searchText);
        if (!matchesName && !matchesCode && !matchesVocab) {
          return false;
        }
      }

      return true;
    });
  }, [results, selectedVocabularies, selectedCombos, selectedDoseForms, selectedDfgCategories, textFilter]);

  // Filter for export (exclude unchecked codes) - memoized
  const filteredResults = useMemo(() =>
    visibleResults.filter((r) => !excludedCodes.has(`${r.child_vocabulary_id}:${r.child_code}`)),
    [visibleResults, excludedCodes]
  );

  // Memoize count maps for filter options (prevents recalculating on every render)
  const comboCounts = useMemo(() => {
    const counts = new Map<string, number>();
    results.forEach((r) => {
      if (r.combinationyesno) {
        counts.set(r.combinationyesno, (counts.get(r.combinationyesno) || 0) + 1);
      }
    });
    return counts;
  }, [results]);

  const doseFormCounts = useMemo(() => {
    const counts = new Map<string, number>();
    results.forEach((r) => {
      if (r.dose_form) {
        counts.set(r.dose_form, (counts.get(r.dose_form) || 0) + 1);
      }
    });
    return counts;
  }, [results]);

  const dfgCategoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    results.forEach((r) => {
      if (r.dfg_name) {
        counts.set(r.dfg_name, (counts.get(r.dfg_name) || 0) + 1);
      }
    });
    return counts;
  }, [results]);

  const vocabularyCounts = useMemo(() => {
    const counts = new Map<string, number>();
    results.forEach((r) => {
      counts.set(r.child_vocabulary_id, (counts.get(r.child_vocabulary_id) || 0) + 1);
    });
    return counts;
  }, [results]);

  // Group visible results by vocabulary (includes excluded codes for display) - memoized
  const groupedResults = useMemo(() => {
    return visibleResults.reduce((acc, result) => {
      if (!acc[result.child_vocabulary_id]) {
        acc[result.child_vocabulary_id] = [];
      }
      acc[result.child_vocabulary_id].push(result);
      return acc;
    }, {} as Record<string, CodeSetResult[]>);
  }, [visibleResults]);

  // Toggle vocabulary filter (pending state)
  const toggleVocabulary = (vocab: string) => {
    const newSelected = new Set(pendingVocabularies);
    if (newSelected.has(vocab)) {
      newSelected.delete(vocab);
    } else {
      newSelected.add(vocab);
    }
    setPendingVocabularies(newSelected);
  };

  // Select all vocabularies (pending state)
  const selectAllVocabularies = () => {
    setPendingVocabularies(new Set(availableVocabularies));
  };

  // Clear all vocabulary selections (pending state)
  const clearAllVocabularies = () => {
    setPendingVocabularies(new Set());
  };

  // Toggle drug filter selections (pending state)
  const toggleCombo = (combo: string) => {
    const newSelected = new Set(pendingCombos);
    if (newSelected.has(combo)) {
      newSelected.delete(combo);
    } else {
      newSelected.add(combo);
    }
    setPendingCombos(newSelected);
  };

  const toggleDoseForm = (doseForm: string) => {
    const newSelected = new Set(pendingDoseForms);
    if (newSelected.has(doseForm)) {
      newSelected.delete(doseForm);
    } else {
      newSelected.add(doseForm);
    }
    setPendingDoseForms(newSelected);
  };

  const toggleDfgCategory = (dfgCategory: string) => {
    const newSelected = new Set(pendingDfgCategories);
    if (newSelected.has(dfgCategory)) {
      newSelected.delete(dfgCategory);
    } else {
      newSelected.add(dfgCategory);
    }
    setPendingDfgCategories(newSelected);
  };

  // Display limit functions for per-vocabulary pagination
  const getVocabDisplayLimit = (vocab: string) => {
    return vocabDisplayLimits.get(vocab) || DEFAULT_DISPLAY_LIMIT;
  };

  const showMoreForVocab = (vocab: string) => {
    const currentLimit = getVocabDisplayLimit(vocab);
    const newLimits = new Map(vocabDisplayLimits);
    newLimits.set(vocab, currentLimit + 100);
    setVocabDisplayLimits(newLimits);
  };

  const showAllForVocab = (vocab: string) => {
    const newLimits = new Map(vocabDisplayLimits);
    newLimits.set(vocab, Infinity);
    setVocabDisplayLimits(newLimits);
  };

  // Toggle individual code exclusion
  const toggleCodeExclusion = (vocab: string, code: string) => {
    const key = `${vocab}:${code}`;
    const newExcluded = new Set(excludedCodes);
    if (newExcluded.has(key)) {
      newExcluded.delete(key);
    } else {
      newExcluded.add(key);
    }
    setExcludedCodes(newExcluded);
  };

  // Check if a code is excluded
  const isCodeExcluded = (vocab: string, code: string) => {
    return excludedCodes.has(`${vocab}:${code}`);
  };

  // Toggle vocabulary collapse state
  const toggleVocabCollapse = (vocab: string) => {
    const newCollapsed = new Set(collapsedVocabs);
    if (newCollapsed.has(vocab)) {
      newCollapsed.delete(vocab);
    } else {
      newCollapsed.add(vocab);
    }
    setCollapsedVocabs(newCollapsed);
  };

  if (shoppingCart.length === 0) {
    return (
      <div className="card p-6 text-center">
        <AlertCircle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <h3 className="text-sm font-medium text-gray-900 mb-1">
          Shopping Cart is Empty
        </h3>
        <p className="text-xs text-gray-500 mb-3">
          Add concepts from Step 2
        </p>
        {workflow === 'hierarchical' ? (
          <button onClick={onBackToHierarchy} className="btn-primary text-sm px-3 py-1.5">
            <ArrowLeft className="w-3 h-3 mr-1.5" />
            Back to Hierarchy
          </button>
        ) : (
          <button onClick={onBackToSearch} className="btn-primary text-sm px-3 py-1.5">
            <ArrowLeft className="w-3 h-3 mr-1.5" />
            Back to Search
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Cart Summary */}
      <div className="card p-2 bg-primary-50 border-primary-200">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            {(workflow === 'direct' || workflow === 'labtest') ? (
              <>
                <h3 className="text-sm font-semibold text-gray-900 mb-0.5">
                  Building {workflow === 'labtest' ? 'Lab Test' : 'Direct'} from Search
                </h3>
                <div className="flex flex-wrap gap-1 items-center">
                  <span className="text-xs text-gray-700">
                    Search term: <span className="font-semibold">{lastSearchTerm}</span>
                  </span>
                  {lastSearchDomain && (
                    <>
                      <span className="text-gray-300">|</span>
                      <span className="badge badge-primary text-xs px-2 py-0.5">
                        {lastSearchDomain}
                      </span>
                    </>
                  )}
                  <span className="text-gray-300">|</span>
                  <span className="text-xs text-gray-600">
                    {shoppingCart.length} concept{shoppingCart.length !== 1 ? 's' : ''} selected
                  </span>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-sm font-semibold text-gray-900 mb-0.5">
                  Building from {shoppingCart.length} concept{shoppingCart.length !== 1 ? 's' : ''}
                </h3>
                <div className="flex flex-wrap gap-1">
                  {shoppingCart.map((item) => (
                    <span key={item.hierarchy_concept_id} className="badge badge-primary text-xs px-2 py-0.5">
                      {item.concept_name.slice(0, 25)}
                      {item.concept_name.length > 25 ? '...' : ''}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex gap-1">
              {workflow === 'hierarchical' && (
                <button onClick={onBackToHierarchy} className="btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5 whitespace-nowrap">
                  <ArrowLeft className="w-3 h-3" />
                  Back
                </button>
              )}
              {(workflow === 'direct' || workflow === 'labtest') && (
                <button onClick={onBackToSearch} className="btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5 whitespace-nowrap">
                  <ArrowLeft className="w-3 h-3" />
                  Back
                </button>
              )}
              <button onClick={onSwitchToHierarchical} className="btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5 whitespace-nowrap">
                <Plus className="w-3 h-3" />
                Add using Hierarchy
              </button>
              <button onClick={onSwitchToDirect} className="btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5 whitespace-nowrap">
                <Plus className="w-3 h-3" />
                Add Direct
              </button>
              <button onClick={onSwitchToLabTest} className="btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5 whitespace-nowrap">
                <Plus className="w-3 h-3" />
                Add Lab Test
              </button>
            </div>
            <div className="flex gap-1">
              <button onClick={onClearCart} className="btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5 text-orange-600 hover:text-orange-700 whitespace-nowrap">
                <RotateCcw className="w-3 h-3" />
                Clear Cart
              </button>
              <button onClick={onStartOver} className="btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5 text-red-600 hover:text-red-700 whitespace-nowrap">
                <X className="w-3 h-3" />
                Restart Build
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Build Code Set Button */}
      {!hasBuilt && !loading && (
        <div className="card p-4 text-center">
          <PackageCheck className="w-10 h-10 text-primary-600 mx-auto mb-2" />
          <h3 className="text-sm font-semibold text-gray-900 mb-1">
            Ready to Build Code Set
          </h3>
          <p className="text-xs text-gray-600 mb-3">
            Generate from {shoppingCart.length} selected concept{shoppingCart.length !== 1 ? 's' : ''} using {buildType === 'hierarchical' ? 'Hierarchical Build' : 'Direct Build'}
          </p>

          {/* Combo Filter (Drug domain only) */}
          {shoppingCart.some((item) => item.domain_id === 'Drug') && buildType === 'hierarchical' && (
            <div className="mb-3 flex justify-center">
              <div className="inline-flex flex-col items-start">
                <label htmlFor="comboFilter" className="block text-xs font-medium text-gray-700 mb-1">
                  Drug Filter (optional)
                </label>
                <select
                  id="comboFilter"
                  value={comboFilter}
                  onChange={(e) => setComboFilter(e.target.value as ComboFilter)}
                  className="select-field text-sm max-w-xs"
                  disabled={loading}
                >
                  <option value="ALL">All Drugs</option>
                  <option value="SINGLE">Single Ingredient Only</option>
                  <option value="COMBINATION">Combination Drugs Only</option>
                </select>
              </div>
            </div>
          )}

          <button onClick={buildSet} className="btn-primary flex items-center gap-2 mx-auto px-6 py-2 text-sm">
            <PackageCheck className="w-4 h-4" />
            Build Code Set
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="card p-6 text-center">
          <Loader2 className="w-10 h-10 text-primary-600 animate-spin mx-auto mb-2" />
          <p className="text-xs text-gray-600">Building code set...</p>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-800">{error}</p>
        </div>
      )}

      {/* Results */}
      {!loading && results.length > 0 && (
        <>
          {/* Combined Filters Panel */}
          {(availableVocabularies.length > 1 || availableCombos.length > 0 || availableDoseForms.length > 0 || availableDfgCategories.length > 0) && (
            <div className="card p-3">
              {/* Text Filter - Full Width at Top */}
              <div className="mb-4">
                <label htmlFor="textFilter" className="block text-xs font-medium text-gray-700 mb-1">
                  Filter by name, code, or vocabulary (2+ chars)
                </label>
                <input
                  id="textFilter"
                  type="text"
                  value={textFilter}
                  onChange={(e) => setTextFilter(e.target.value)}
                  placeholder="Search results..."
                  className="input-field text-sm w-full max-w-md"
                  autoComplete="off"
                />
              </div>

              <div className="flex flex-wrap gap-4 items-start">
                {/* Vocabulary Filter */}
                {availableVocabularies.length > 1 && (
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-sm font-semibold text-gray-900 whitespace-nowrap">
                        Filter by Vocabulary
                      </h3>
                      <div className="flex gap-2">
                        <button
                          onClick={selectAllVocabularies}
                          className="text-xs text-primary-600 hover:text-primary-700 font-medium"
                        >
                          All
                        </button>
                        <span className="text-gray-300">|</span>
                        <button
                          onClick={clearAllVocabularies}
                          className="text-xs text-primary-600 hover:text-primary-700 font-medium"
                        >
                          None
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {availableVocabularies.map((vocab) => {
                        const count = vocabularyCounts.get(vocab) || 0;
                        const isSelected = pendingVocabularies.has(vocab);
                        return (
                          <button
                            key={vocab}
                            onClick={() => toggleVocabulary(vocab)}
                            className={`
                              px-2 py-1 rounded-lg border text-xs font-medium transition-colors
                              ${
                                isSelected
                                  ? 'bg-primary-100 border-primary-300 text-primary-700'
                                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                              }
                            `}
                          >
                            {vocab} ({count})
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Combo Filter - Multi-select */}
                {availableCombos.length > 0 && (
                  <div className="w-40 flex-shrink-0 relative">
                    <h3 className="text-sm font-semibold text-gray-900 mb-2">Combination</h3>
                    <div className="relative">
                      <button
                        type="button"
                        className="select-field text-xs w-full text-left flex items-center justify-between"
                        onClick={() => {
                          const dropdown = document.getElementById('combo-dropdown');
                          if (dropdown) dropdown.classList.toggle('hidden');
                        }}
                      >
                        <span className="truncate">
                          {pendingCombos.size === 0 ? 'All' : `${pendingCombos.size} selected`}
                        </span>
                        <ChevronDown className="w-3 h-3 ml-1 flex-shrink-0" />
                      </button>
                      <div
                        id="combo-dropdown"
                        className="hidden absolute z-10 mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto"
                      >
                        {availableCombos.map((combo) => {
                          const count = comboCounts.get(combo) || 0;
                          const isSelected = pendingCombos.has(combo);
                          return (
                            <label
                              key={combo}
                              className="flex items-center px-2 py-1.5 hover:bg-gray-50 cursor-pointer text-xs"
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleCombo(combo)}
                                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 mr-2"
                              />
                              <span className="flex-1">{combo} ({count})</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* Dose Form Filter - Multi-select */}
                {availableDoseForms.length > 0 && (
                  <div className="w-80 flex-shrink-0 relative">
                    <h3 className="text-sm font-semibold text-gray-900 mb-2">Dose Form</h3>
                    <div className="relative">
                      <button
                        type="button"
                        className="select-field text-xs w-full text-left flex items-center justify-between"
                        onClick={() => {
                          const dropdown = document.getElementById('doseform-dropdown');
                          if (dropdown) dropdown.classList.toggle('hidden');
                        }}
                      >
                        <span className="truncate">
                          {pendingDoseForms.size === 0 ? 'All' : `${pendingDoseForms.size} selected`}
                        </span>
                        <ChevronDown className="w-3 h-3 ml-1 flex-shrink-0" />
                      </button>
                      <div
                        id="doseform-dropdown"
                        className="hidden absolute z-10 mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto"
                      >
                        {availableDoseForms.map((doseForm) => {
                          const count = doseFormCounts.get(doseForm) || 0;
                          const isSelected = pendingDoseForms.has(doseForm);
                          return (
                            <label
                              key={doseForm}
                              className="flex items-center px-2 py-1.5 hover:bg-gray-50 cursor-pointer text-xs"
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleDoseForm(doseForm)}
                                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 mr-2"
                              />
                              <span className="flex-1">{doseForm} ({count})</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* DFG Category Filter - Multi-select */}
                {availableDfgCategories.length > 0 && (
                  <div className="w-40 flex-shrink-0 relative">
                    <h3 className="text-sm font-semibold text-gray-900 mb-2">DFG Category</h3>
                    <div className="relative">
                      <button
                        type="button"
                        className="select-field text-xs w-full text-left flex items-center justify-between"
                        onClick={() => {
                          const dropdown = document.getElementById('dfg-dropdown');
                          if (dropdown) dropdown.classList.toggle('hidden');
                        }}
                      >
                        <span className="truncate">
                          {pendingDfgCategories.size === 0 ? 'All' : `${pendingDfgCategories.size} selected`}
                        </span>
                        <ChevronDown className="w-3 h-3 ml-1 flex-shrink-0" />
                      </button>
                      <div
                        id="dfg-dropdown"
                        className="hidden absolute z-10 mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto"
                      >
                        {availableDfgCategories.map((dfg) => {
                          const count = dfgCategoryCounts.get(dfg) || 0;
                          const isSelected = pendingDfgCategories.has(dfg);
                          return (
                            <label
                              key={dfg}
                              className="flex items-center px-2 py-1.5 hover:bg-gray-50 cursor-pointer text-xs"
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleDfgCategory(dfg)}
                                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 mr-2"
                              />
                              <span className="flex-1">{dfg} ({count})</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

              </div>

              {/* Apply Filters Button & Status */}
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <button
                    onClick={applyFilters}
                    disabled={!hasPendingChanges}
                    className={`
                      btn-primary flex items-center gap-1.5 text-sm px-4 py-2
                      ${!hasPendingChanges ? 'opacity-50 cursor-not-allowed' : ''}
                    `}
                  >
                    <PackageCheck className="w-4 h-4" />
                    Apply Filters
                    {hasPendingChanges && (
                      <span className="ml-1 bg-white text-primary-600 rounded-full px-2 py-0.5 text-xs font-semibold">
                        Pending
                      </span>
                    )}
                  </button>
                  {(pendingVocabularies.size > 0 || pendingCombos.size > 0 || pendingDoseForms.size > 0 || pendingDfgCategories.size > 0) && (
                    <button
                      onClick={clearAllFilters}
                      className="text-xs text-gray-600 hover:text-gray-800 font-medium"
                    >
                      Clear All Filters
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-500">
                  {selectedVocabularies.size === 0 && selectedCombos.size === 0 && selectedDoseForms.size === 0 && selectedDfgCategories.size === 0
                    ? `Showing all ${visibleResults.length} codes`
                    : `Showing ${visibleResults.length} of ${results.length} codes`}
                </p>
              </div>
            </div>
          )}

          {/* Export Buttons */}
          <div className="card p-3">
            <div className="mb-2">
              <h3 className="text-sm font-semibold text-gray-900">
                Export Code Set ({filteredResults.length} codes)
              </h3>
              {excludedCodes.size > 0 && (
                <p className="text-xs text-gray-600 mt-0.5">
                  {excludedCodes.size} code{excludedCodes.size !== 1 ? 's' : ''} excluded
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setShowSaveModal(true)}
                disabled={saving || shoppingCart.length === 0}
                className={`
                  btn-primary flex items-center gap-1.5 text-sm px-3 py-1.5
                  ${saveSuccess ? 'bg-green-600 hover:bg-green-700' : ''}
                `}
              >
                {saveSuccess ? (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    Saved!
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    {saving ? 'Saving...' : 'Save Code Set'}
                  </>
                )}
              </button>
              <button onClick={handleExportTxt} className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5">
                <Download className="w-4 h-4" />
                Export as TXT
              </button>
              <button
                onClick={handleCopySql}
                className={`
                  btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5
                  ${sqlCopied ? 'bg-green-50 text-green-700 border-green-200' : ''}
                `}
              >
                {sqlCopied ? (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    Copy SQL
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Results by Vocabulary */}
          {Object.entries(groupedResults).map(([vocabulary, vocabResults]) => {
            const isCollapsed = collapsedVocabs.has(vocabulary);
            const includedCount = vocabResults.filter((r) => !isCodeExcluded(vocabulary, r.child_code)).length;
            const excludedCount = vocabResults.length - includedCount;
            const displayLimit = getVocabDisplayLimit(vocabulary);
            const displayedResults = vocabResults.slice(0, displayLimit);
            const hasMore = vocabResults.length > displayLimit;
            const remainingCount = vocabResults.length - displayLimit;

            return (
              <div key={vocabulary} className="card p-3">
                <div
                  className="flex items-center justify-between mb-2 cursor-pointer hover:bg-gray-50 -m-3 p-3 rounded-t-lg"
                  onClick={() => toggleVocabCollapse(vocabulary)}
                >
                  <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                    {isCollapsed ? (
                      <ChevronRight className="w-4 h-4 text-gray-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-gray-400" />
                    )}
                    <span className="badge badge-primary text-xs px-2 py-0.5">{vocabulary}</span>
                    <span className="text-xs font-normal text-gray-500">
                      ({vocabResults.length} codes{hasMore ? `, showing ${displayedResults.length}` : ''})
                    </span>
                  </h3>
                  {excludedCount > 0 && (
                    <span className="text-xs text-gray-600">
                      {excludedCount} excluded
                    </span>
                  )}
                </div>

                {!isCollapsed && (
                  <>
                    <div className="table-container">
                      <table className="table compact-table">
                        <thead>
                          <tr>
                            <th className="w-12 text-xs py-1.5"></th>
                            <th className="text-xs py-1.5">Code</th>
                            <th className="text-xs py-1.5">Name</th>
                            <th className="text-xs py-1.5">Concept ID</th>
                            <th className="text-xs py-1.5">Class</th>
                            {vocabResults[0]?.combinationyesno && <th className="text-xs py-1.5">Combo</th>}
                            {vocabResults[0]?.dose_form && <th className="text-xs py-1.5">Dose Form</th>}
                            {vocabResults[0]?.dfg_name && <th className="text-xs py-1.5">DFG Category</th>}
                            {vocabResults.some((r) => r.value) && <th className="text-xs py-1.5">Attribute</th>}
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {displayedResults.map((result, index) => {
                            const isExcluded = isCodeExcluded(vocabulary, result.child_code);
                            return (
                              <tr
                                key={`${result.child_concept_id}-${index}`}
                                className={isExcluded ? 'bg-gray-50 opacity-60' : ''}
                              >
                                <td className="py-1.5 px-2">
                                  <input
                                    type="checkbox"
                                    checked={!isExcluded}
                                    onChange={() => toggleCodeExclusion(vocabulary, result.child_code)}
                                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                    title={isExcluded ? "Include in export" : "Exclude from export"}
                                  />
                                </td>
                                <td className="font-mono text-xs py-1.5 px-2">{result.child_code}</td>
                                <td className="font-medium text-sm py-1.5 px-2">{result.child_name}</td>
                                <td className="text-xs py-1.5 px-2">{result.child_concept_id}</td>
                                <td className="text-xs text-gray-600 py-1.5 px-2">{result.concept_class_id}</td>
                              {result.combinationyesno && (
                                <td className="py-1.5 px-2">
                                  <span
                                    className={`badge text-xs px-1.5 py-0.5 ${
                                      result.combinationyesno === 'COMBINATION'
                                        ? 'badge-warning'
                                        : 'badge-success'
                                    }`}
                                  >
                                    {result.combinationyesno}
                                  </span>
                                </td>
                              )}
                              {result.dose_form && (
                                <td className="text-xs text-gray-600 py-1.5 px-2">{result.dose_form}</td>
                              )}
                              {result.dfg_name && (
                                <td className="py-1.5 px-2">
                                  <span className="badge badge-info text-xs px-1.5 py-0.5">
                                    {result.dfg_name}
                                  </span>
                                </td>
                              )}
                              {vocabResults.some((r) => r.value) && (
                                <td className="text-xs text-gray-600 py-1.5 px-2">{result.value || '-'}</td>
                              )}
                            </tr>
                          );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Show More / Show All buttons */}
                    {hasMore && (
                      <div className="mt-3 flex items-center justify-center gap-2 pt-2 border-t border-gray-200">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            showMoreForVocab(vocabulary);
                          }}
                          className="btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5"
                        >
                          <ChevronDown className="w-3 h-3" />
                          Show 100 More ({remainingCount} remaining)
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            showAllForVocab(vocabulary);
                          }}
                          className="btn-secondary text-xs px-3 py-1.5"
                        >
                          Show All {vocabResults.length}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* Save Code Set Modal */}
      <SaveCodeSetModal
        isOpen={showSaveModal}
        onClose={() => !saving && setShowSaveModal(false)}
        onSave={handleSaveCodeSet}
        conceptCount={filteredResults.length}
        saving={saving}
      />

      {/* Filtering Modal - Prominent overlay */}
      {isFiltering && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-30">
          <div className="bg-white rounded-lg shadow-2xl p-6 flex flex-col items-center gap-3">
            <Loader2 className="w-10 h-10 text-primary-600 animate-spin" />
            <p className="text-lg font-semibold text-gray-900">Filtering code set...</p>
            <p className="text-sm text-gray-600">Please wait while we process your filters</p>
          </div>
        </div>
      )}
    </div>
  );
}
