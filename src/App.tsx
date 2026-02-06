import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { upsertUserProfile, testConnection } from './lib/api';
import type { User } from '@supabase/supabase-js';
import type { CartItem, SearchResult, DomainType } from './lib/types';

// Components (will be created next)
import Navigation from './components/Navigation';
import ShoppingCart from './components/ShoppingCart';
import Landing from './components/Landing';
import Step1Search from './components/Step1Search';
import Step1LabTestSearch from './components/Step1LabTestSearch';
import Step2PanelSearch from './components/Step2PanelSearch';
import Step2Hierarchy from './components/Step2Hierarchy';
import Step3CodeSet from './components/Step3CodeSet';
import SavedCodeSets from './components/SavedCodeSets';
import AuthPage from './components/AuthPage';
import DirectionsModal from './components/DirectionsModal';

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [dbConnectionStatus, setDbConnectionStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [dbErrorMessage, setDbErrorMessage] = useState<string>('');
  const [workflow, setWorkflow] = useState<'direct' | 'hierarchical' | 'labtest' | null>(null);
  const [currentStep, setCurrentStep] = useState<0 | 1 | 2 | 3>(0);
  const [labtestStep, setLabtestStep] = useState<1 | 2>(1); // Lab Test workflow: 1 = Lab Tests, 2 = Panels
  const [shoppingCart, setShoppingCart] = useState<CartItem[]>([]);
  const [selectedConcept, setSelectedConcept] = useState<SearchResult | null>(null);
  const [selectedDomain, setSelectedDomain] = useState<DomainType | null>(null);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isDirectionsOpen, setIsDirectionsOpen] = useState(false);

  // Persist search state across navigation
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [lastSearchTerm, setLastSearchTerm] = useState('');
  const [lastSearchDomain, setLastSearchDomain] = useState<DomainType | ''>('');

  // Check if auth is disabled for local development
  const authDisabled = import.meta.env.VITE_DISABLE_AUTH === 'true';

  // Check for existing session on mount
  useEffect(() => {
    // Skip auth check if disabled
    if (authDisabled) {
      setUser({ id: 'local-dev', email: 'dev@local.test' } as User);
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);

      // Create/update user profile on login
      if (session?.user) {
        upsertUserProfile(
          session.user.id,
          session.user.email!,
          session.user.user_metadata?.display_name
        ).catch(() => {
          // Silently handle error
        });
      }
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);

      // Create/update user profile on auth state change
      if (session?.user) {
        upsertUserProfile(
          session.user.id,
          session.user.email!,
          session.user.user_metadata?.display_name
        ).catch(() => {
          // Silently handle error
        });
      }
    });

    return () => subscription.unsubscribe();
  }, [authDisabled]);

  // Check database connection once on app startup
  useEffect(() => {
    const checkDbConnection = async () => {
      try {
        await testConnection();
        setDbConnectionStatus('connected');
      } catch (error) {
        setDbConnectionStatus('error');
        setDbErrorMessage(error instanceof Error ? error.message : 'Failed to connect to database');
      }
    };

    checkDbConnection();
  }, []); // Empty dependency array - only runs once on mount

  // Handle loading cart items from navigation state (for edit functionality)
  useEffect(() => {
    const state = location.state as { cartItems?: CartItem[]; autoRebuild?: boolean } | null;
    if (state?.cartItems && state.cartItems.length > 0) {
      setShoppingCart(state.cartItems);
      setCurrentStep(3);

      // Clear the navigation state to prevent reloading on page refresh
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, navigate]);

  // Shopping cart functions
  const addToCart = (item: CartItem) => {
    // Check if item already exists in cart
    const exists = shoppingCart.some(
      (cartItem) => cartItem.hierarchy_concept_id === item.hierarchy_concept_id
    );

    if (!exists) {
      setShoppingCart([...shoppingCart, item]);
    }
  };

  const removeFromCart = (hierarchyConceptId: number) => {
    setShoppingCart(shoppingCart.filter((item) => item.hierarchy_concept_id !== hierarchyConceptId));
  };

  const removeMultipleFromCart = (conceptIds: number[]) => {
    const idsToRemove = new Set(conceptIds);
    setShoppingCart(shoppingCart.filter((item) => !idsToRemove.has(item.hierarchy_concept_id)));
  };

  const clearCart = () => {
    setShoppingCart([]);
  };

  // Workflow selection handler
  const handleWorkflowSelected = (selectedWorkflow: 'direct' | 'hierarchical' | 'labtest') => {
    setWorkflow(selectedWorkflow);
    setCurrentStep(1);
    setLabtestStep(1); // Reset to Step 1 for Lab Test workflow
    navigate('/search');
  };

  // Navigation functions
  const goToStep = (step: 0 | 1 | 2 | 3) => {
    setCurrentStep(step);
  };

  const handleConceptSelected = (concept: SearchResult, domain: DomainType) => {
    setSelectedConcept(concept);
    setSelectedDomain(domain);
    setCurrentStep(2);
    navigate('/hierarchy');
  };

  // Clear Cart - clears cart and returns to Step 1 (preserves search results)
  const handleClearCart = () => {
    clearCart();
    setCurrentStep(1);
    navigate('/search');
  };

  // Start Over - returns to workflow selection (clears everything)
  const handleStartOver = () => {
    clearCart();
    setSelectedConcept(null);
    setSelectedDomain(null);
    setWorkflow(null);
    setCurrentStep(0);
    // Clear search state
    setSearchResults([]);
    setLastSearchTerm('');
    setLastSearchDomain('');
    navigate('/');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // If not authenticated, show auth page
  if (!user) {
    return <AuthPage />;
  }

  return (
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <header className="bg-white shadow-sm border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
            <div className="flex justify-between items-center">
              <div>
                <h1 className="text-lg font-bold text-gray-900">
                  Medical Code Set Builder
                </h1>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => navigate('/saved')}
                  className="btn-secondary text-xs px-3 py-1.5"
                >
                  My Saved Code Sets
                </button>
                <button
                  onClick={() => setIsDirectionsOpen(true)}
                  className="btn-secondary text-xs px-3 py-1.5"
                >
                  How to Use
                </button>
                <span className="text-xs text-gray-600">{user.email}</span>
                <button
                  onClick={() => supabase.auth.signOut()}
                  className="btn-secondary text-xs px-3 py-1.5"
                >
                  Sign Out
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Navigation Progress Indicator */}
        {workflow !== null && (
          <Navigation
            currentStep={currentStep}
            workflow={workflow}
            onStepClick={goToStep}
            cartItemCount={shoppingCart.length}
            onCartClick={() => setIsCartOpen(true)}
            onStartOver={handleStartOver}
          />
        )}

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          {/* Main Content Area - Full Width */}
          <div>
            <Routes>
                <Route
                  path="/"
                  element={
                    workflow === null ? (
                      <Landing
                        onSelectWorkflow={handleWorkflowSelected}
                        connectionStatus={dbConnectionStatus}
                        errorMessage={dbErrorMessage}
                      />
                    ) : (
                      <Navigate to="/search" replace />
                    )
                  }
                />
                <Route
                  path="/search"
                  element={
                    workflow === null ? (
                      <Navigate to="/" replace />
                    ) : workflow === 'labtest' ? (
                      <>
                        <div style={{ display: labtestStep === 1 ? 'block' : 'none' }}>
                          <Step1LabTestSearch
                            addToCart={addToCart}
                            removeFromCart={removeFromCart}
                            addMultipleToCart={(items) => {
                              const existingIds = new Set(shoppingCart.map(item => item.hierarchy_concept_id));
                              const newItems = items.filter(item => !existingIds.has(item.hierarchy_concept_id));
                              setShoppingCart([...shoppingCart, ...newItems]);
                            }}
                            removeMultipleFromCart={removeMultipleFromCart}
                            shoppingCart={shoppingCart}
                            goToPanelStep={() => setLabtestStep(2)}
                          />
                        </div>
                        <div style={{ display: labtestStep === 2 ? 'block' : 'none' }}>
                          <Step2PanelSearch
                            addToCart={addToCart}
                            removeFromCart={removeFromCart}
                            shoppingCart={shoppingCart}
                            goToLabTestStep={() => setLabtestStep(1)}
                          />
                        </div>
                      </>
                    ) : (
                      <Step1Search
                        onConceptSelected={handleConceptSelected}
                        currentStep={currentStep}
                        workflow={workflow}
                        searchResults={searchResults}
                        setSearchResults={setSearchResults}
                        lastSearchTerm={lastSearchTerm}
                        setLastSearchTerm={setLastSearchTerm}
                        lastSearchDomain={lastSearchDomain}
                        setLastSearchDomain={setLastSearchDomain}
                        addToCart={addToCart}
                        removeFromCart={removeFromCart}
                        addMultipleToCart={(items) => {
                          const existingIds = new Set(shoppingCart.map(item => item.hierarchy_concept_id));
                          const newItems = items.filter(item => !existingIds.has(item.hierarchy_concept_id));
                          setShoppingCart([...shoppingCart, ...newItems]);
                        }}
                        removeMultipleFromCart={removeMultipleFromCart}
                        shoppingCart={shoppingCart}
                      />
                    )
                  }
                />
                <Route
                  path="/hierarchy"
                  element={
                    workflow === 'direct' ? (
                      <Navigate to="/search" replace />
                    ) : (
                      <Step2Hierarchy
                        selectedConcept={selectedConcept}
                        selectedDomain={selectedDomain}
                        shoppingCart={shoppingCart}
                        onAddToCart={addToCart}
                        onBackToSearch={() => {
                          setCurrentStep(1);
                          navigate('/search');
                        }}
                        onProceedToCodeSet={() => {
                          setCurrentStep(3);
                          navigate('/codeset');
                        }}
                        currentStep={currentStep}
                      />
                    )
                  }
                />
                <Route
                  path="/codeset"
                  element={
                    <Step3CodeSet
                      shoppingCart={shoppingCart}
                      workflow={workflow}
                      onBackToHierarchy={() => {
                        setCurrentStep(2);
                        navigate('/hierarchy');
                      }}
                      onBackToSearch={() => {
                        setCurrentStep(1);
                        navigate('/search');
                      }}
                      onSwitchToHierarchical={() => {
                        setWorkflow('hierarchical');
                        setCurrentStep(1);
                        navigate('/search');
                      }}
                      onSwitchToDirect={() => {
                        setWorkflow('direct');
                        setCurrentStep(1);
                        navigate('/search');
                      }}
                      onSwitchToLabTest={() => {
                        setWorkflow('labtest');
                        setCurrentStep(1);
                        navigate('/search');
                      }}
                      onClearCart={handleClearCart}
                      onStartOver={handleStartOver}
                      currentStep={currentStep}
                      lastSearchTerm={lastSearchTerm}
                      lastSearchDomain={lastSearchDomain}
                    />
                  }
                />
                <Route
                  path="/saved"
                  element={<SavedCodeSets />}
                />
              </Routes>
          </div>
        </main>

        {/* Shopping Cart Slide-out Panel */}
        <ShoppingCart
          items={shoppingCart}
          onRemove={removeFromCart}
          onClear={clearCart}
          onBuildCodeSet={() => {
            setCurrentStep(3);
            navigate('/codeset', { state: { buildType: 'hierarchical' } });
          }}
          onDirectBuild={() => {
            setCurrentStep(3);
            navigate('/codeset', { state: { buildType: 'direct' } });
          }}
          isOpen={isCartOpen}
          onClose={() => setIsCartOpen(false)}
        />

        {/* Footer */}
        <footer className="bg-white border-t border-gray-200 mt-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <p className="text-center text-sm text-gray-500">
              Medical Code Set Builder | Built with React + Azure SQL Server + OMOP Vocabulary
            </p>
          </div>
        </footer>

        {/* Directions Modal */}
        <DirectionsModal
          isOpen={isDirectionsOpen}
          onClose={() => setIsDirectionsOpen(false)}
        />
      </div>
  );
}

function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}

export default App;
