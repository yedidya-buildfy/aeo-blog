import { useState, useEffect } from "react";
import {
  Card,
  Text,
  Button,
  BlockStack,
  InlineStack,
  Badge,
  Spinner,
} from "@shopify/polaris";
import { useFetcher, useNavigate } from "@remix-run/react";

interface WizardOverlayProps {
  isActive: boolean;
  onComplete: () => void;
  onSkip: () => void;
  aeoSuccessTriggered?: boolean;
  onNavigateToSEOBlogs?: () => void;
  startFromStep?: 1 | 2 | 3;
  planConfirmed?: boolean;
  paymentError?: boolean;
  currentPlan?: 'free' | 'starter' | 'pro' | null;
}

interface WizardState {
  currentStep: 1 | 2 | 3;
  selectedPlan: 'free' | 'starter' | 'pro' | null;
  aeoCompleted: boolean;
  planSelected: boolean;
  blogsCompleted: boolean;
  isAEORunning: boolean;
  isBlogGenerating: boolean;
  isProcessingPayment: boolean;
  currentOperation: string;
  error: string | null;
  showSuccess: boolean;
  autoCloseTimer: number;
  // Progress tracking for step 3
  keywordsFound: boolean;
  firstBlogGenerated: boolean;
  automationEnabled: boolean;
}

export default function WizardOverlay({ isActive, onComplete, onSkip, aeoSuccessTriggered, onNavigateToSEOBlogs, startFromStep = 1, planConfirmed = false, paymentError = false, currentPlan = null }: WizardOverlayProps) {
  const fetcher = useFetcher();
  const planSelectionFetcher = useFetcher();
  const navigate = useNavigate();
  const [wizardState, setWizardState] = useState<WizardState>({
    currentStep: startFromStep,
    selectedPlan: null,
    aeoCompleted: startFromStep >= 2, // If starting from step 2+, AEO is already complete
    planSelected: false,
    blogsCompleted: false,
    isAEORunning: false,
    isBlogGenerating: false,
    isProcessingPayment: false,
    currentOperation: '',
    error: null,
    showSuccess: false,
    autoCloseTimer: 0,
    // Progress tracking for step 3
    keywordsFound: false,
    firstBlogGenerated: false,
    automationEnabled: false,
  });

  // Listen for AEO success from parent
  useEffect(() => {
    if (aeoSuccessTriggered) {
      setWizardState(prev => ({
        ...prev,
        aeoCompleted: true,
        currentStep: 2
      }));

      // Navigate to SEO blogs page with wizard at step 2 after AEO completion
      if (onNavigateToSEOBlogs) {
        setTimeout(() => {
          // Must use window.location for cross-route navigation in Shopify embedded apps
          const currentParams = new URLSearchParams(window.location.search);
          currentParams.set('showWizard', 'true');
          currentParams.set('step', '2');
          window.location.href = `/app/seo-blogs?${currentParams.toString()}`;
        }, 1500); // Small delay to show success message
      }
    }
  }, [aeoSuccessTriggered, onNavigateToSEOBlogs, navigate]);

  // Handle billing confirmation or error from URL parameters
  useEffect(() => {
    if (planConfirmed) {
      console.log('[Wizard] Plan confirmed from billing, advancing to step 3');
      setWizardState(prev => ({
        ...prev,
        currentStep: 3,
        planSelected: true,
        isProcessingPayment: false,
        error: null,
        aeoCompleted: true // Ensure AEO is marked as completed
      }));
    } else if (paymentError) {
      console.log('[Wizard] Payment error detected, showing error in step 2');
      setWizardState(prev => ({
        ...prev,
        currentStep: 2,
        planSelected: false,
        isProcessingPayment: false,
        error: 'Payment was cancelled or failed. Please try selecting a plan again.',
        aeoCompleted: true // Keep AEO as completed
      }));
    }
  }, [planConfirmed, paymentError]);

  if (!isActive) return null;

  const handleSelectPlan = async (plan: 'free' | 'starter' | 'pro') => {
    console.log(`[Wizard] Plan selected: ${plan}`);

    setWizardState(prev => ({
      ...prev,
      selectedPlan: plan,
      isProcessingPayment: plan !== 'free',
      error: null,
      currentOperation: plan === 'free' ? 'Activating free plan...' : 'Redirecting to billing...'
    }));

    if (plan === 'free') {
      // For free plan, proceed directly to step 3
      setWizardState(prev => ({
        ...prev,
        planSelected: true,
        currentStep: 3,
        isProcessingPayment: false,
        currentOperation: '',
        error: null
      }));
    } else {
      // For paid plans, use the simple billing route
      planSelectionFetcher.submit(
        { plan },
        { method: 'POST', action: '/api/subscribe' }
      );
    }
  };

  // Watch for fetcher state changes and update progress based on actual API response
  useEffect(() => {
    if (fetcher.state === 'submitting') {
      // API is working, keep showing loading state
      setWizardState(prev => ({
        ...prev,
        error: null,
        currentOperation: 'Finding best keywords...',
      }));
    } else if (fetcher.state === 'idle' && fetcher.data) {
      const responseData = fetcher.data as any;

      if (responseData?.success) {
        // Update progress indicators based on actual API response
        const keywordsFound = responseData.keywordsFound === true || (responseData.keywordCount && responseData.keywordCount > 0);
        const firstBlogGenerated = responseData.firstBlogGenerated === true || (responseData.blogsGenerated && responseData.blogsGenerated > 0);
        const automationEnabled = responseData.automationEnabled === true;

        // Set all progress indicators
        setWizardState(prev => ({
          ...prev,
          keywordsFound,
          firstBlogGenerated,
          automationEnabled,
          currentOperation: 'All steps completed! 🎉',
        }));

        // Wait 2 seconds after all steps complete, then show success screen
        setTimeout(() => {
          setWizardState(prev => ({
            ...prev,
            isBlogGenerating: false,
            blogsCompleted: true,
            showSuccess: true,
            autoCloseTimer: 5,
            currentOperation: '🎉 Setup Complete! Your AEO improvements are now active.'
          }));

          // Start countdown timer for auto-close
          const countdown = setInterval(() => {
            setWizardState(prev => {
              if (prev.autoCloseTimer <= 1) {
                clearInterval(countdown);
                // Call onComplete to hide wizard and redirect to clean URL
                setTimeout(() => {
                  // Must use window.location for Shopify embedded apps
                  const currentParams = new URLSearchParams(window.location.search);
                  currentParams.delete('showWizard');
                  currentParams.delete('step');
                  currentParams.delete('planConfirmed');
                  currentParams.delete('paymentError');
                  const paramString = currentParams.toString();
                  window.location.href = `/app/seo-blogs${paramString ? '?' + paramString : ''}`;
                }, 100);
                return prev;
              }
              return { ...prev, autoCloseTimer: prev.autoCloseTimer - 1 };
            });
          }, 1000);
        }, 2000); // 2 second delay after all steps complete
      } else {
        setWizardState(prev => ({
          ...prev,
          isBlogGenerating: false,
          error: responseData?.error || 'Setup failed. Please try again.',
          currentOperation: '',
          keywordsFound: false,
          firstBlogGenerated: false,
          automationEnabled: false,
        }));
      }
    }
  }, [fetcher.state, fetcher.data, onComplete]);

  // Watch for plan selection fetcher state changes (for paid plans only)
  useEffect(() => {
    console.log('[Wizard] Plan fetcher state:', planSelectionFetcher.state);

    if (planSelectionFetcher.state === 'idle' && planSelectionFetcher.data) {
      const data = planSelectionFetcher.data as any;
      console.log('[Wizard] Plan fetcher data:', data);

      if (data.success && data.confirmationUrl) {
        // Redirect to Shopify's billing confirmation page using top-level redirect
        console.log('[Wizard] Redirecting to Shopify billing:', data.confirmationUrl);
        // Use top-level redirect to break out of iframe
        window.top!.location.href = data.confirmationUrl;
      } else if (data.success && data.alreadySubscribed) {
        // Already subscribed, redirect directly to step 3
        console.log('[Wizard] Already subscribed, going to step 3');
        // Must use window.location for Shopify embedded apps
        window.location.href = data.redirectUrl;
      } else if (data.success === false) {
        // Error in plan selection
        console.error('[Wizard] Plan selection error:', data.error);
        setWizardState(prev => ({
          ...prev,
          error: data.error || 'Failed to select plan. Please try again.',
          isProcessingPayment: false,
          currentOperation: ''
        }));
      }
    }

    if (planSelectionFetcher.state === 'submitting') {
      console.log('[Wizard] Submitting plan selection...');
    }
  }, [planSelectionFetcher.state, planSelectionFetcher.data]);

  const handleStartBlogGeneration = async () => {
    // Start the generation process
    setWizardState(prev => ({
      ...prev,
      isBlogGenerating: true,
      currentOperation: 'Finding best keywords...',
      keywordsFound: false,
      firstBlogGenerated: false,
      automationEnabled: false,
    }));

    // Use fetcher to call our server action with proper authentication
    fetcher.submit({}, {
      method: 'POST',
      action: '/api/wizard-setup'
    });
  };

  const renderStep1 = () => (
    <BlockStack gap="400">
      <Text as="h2" variant="headingLg">🚀 Welcome to AEO</Text>
      <Text as="p" variant="bodyMd">
        Ready to optimize your store for AI search engines? Click "Improve My AEO" in the highlighted card to start the process.
      </Text>

      {wizardState.aeoCompleted ? (
        <BlockStack gap="300" align="center">
          <Text as="p" variant="bodyMd" tone="success">✅ AEO Foundation Complete!</Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Great! Now let's choose your plan.
          </Text>
        </BlockStack>
      ) : (
        <BlockStack gap="300" align="center">
          <Text as="p" variant="bodyMd">
            👆 Click "Improve My AEO" in the blue highlighted card
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            We'll wait for you to complete the AEO optimization
          </Text>
        </BlockStack>
      )}
    </BlockStack>
  );

  const renderStep2 = () => {
    if (wizardState.isProcessingPayment) {
      return (
        <BlockStack gap="400">
          <Text as="h2" variant="headingLg">Processing Payment...</Text>
          <BlockStack gap="300" align="center">
            <Spinner size="large" />
            <Text as="p" variant="bodyMd">
              {wizardState.currentOperation}
            </Text>
            {wizardState.selectedPlan !== 'free' && (
              <Text as="p" variant="bodySm" tone="subdued">
                You'll be redirected to Shopify's secure billing page
              </Text>
            )}
          </BlockStack>
        </BlockStack>
      );
    }

    return (
      <BlockStack gap="400">
        <Text as="h2" variant="headingLg">Choose Your AEO Plan</Text>
        <Text as="p" variant="bodyMd" tone="success">✅ AEO Foundation Complete!</Text>

        {wizardState.error && (
          <BlockStack gap="200" align="center">
            <Text as="p" variant="bodyMd" tone="critical">❌ {wizardState.error}</Text>
          </BlockStack>
        )}

      <div style={{
        border: '1px solid #e1e1e1',
        borderRadius: '8px',
        padding: '1rem',
        fontSize: '14px',
        overflow: 'hidden'
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid #e1e1e1', width: '40%' }}>Feature</th>
              <th style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #e1e1e1', width: '20%' }}>Free</th>
              <th style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #e1e1e1', width: '20%' }}>Starter</th>
              <th style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #e1e1e1', width: '20%' }}>Pro</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>LLM Optimization</td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>✅</td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>✅</td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>✅</td>
            </tr>
            <tr>
              <td style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>All LLM Optimization</td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>✗</td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>⏳</td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>⏳</td>
            </tr>
            <tr>
              <td style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>Finding Best Keywords</td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>⏳</td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>⏳</td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>⏳</td>
            </tr>
            <tr>
              <td style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>Initial Blog Generation</td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>⏳</td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>⏳</td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>⏳</td>
            </tr>
            <tr>
              <td style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>Auto Blog Generation</td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>1/week</td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>2/week</td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>5/week</td>
            </tr>
            <tr>
              <td style={{ padding: '8px 12px' }}>Price</td>
              <td style={{ textAlign: 'center', padding: '8px 12px' }}>FREE</td>
              <td style={{ textAlign: 'center', padding: '8px 12px' }}>$4.99/mo</td>
              <td style={{ textAlign: 'center', padding: '8px 12px' }}>$9.99/mo</td>
            </tr>
            <tr>
              <td style={{ padding: '8px 12px', borderTop: '2px solid #e1e1e1' }}></td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderTop: '2px solid #e1e1e1' }}>
                <Button size="slim" onClick={() => handleSelectPlan('free')}>
                  Select Free
                </Button>
              </td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderTop: '2px solid #e1e1e1' }}>
                <Button size="slim" onClick={() => handleSelectPlan('starter')}>
                  Starter
                </Button>
              </td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderTop: '2px solid #e1e1e1' }}>
                <Button size="slim" onClick={() => handleSelectPlan('pro')}>
                  Pro
                </Button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </BlockStack>
    );
  };

  const renderStep3 = () => {
    // Determine the actual plan (from DB or selected in wizard)
    const displayPlan = currentPlan || wizardState.selectedPlan || 'free';
    const isPaidPlan = displayPlan === 'starter' || displayPlan === 'pro';

    return (
    <BlockStack gap="400">
      <Text as="h2" variant="headingLg">📝 Ready to Generate SEO Blogs?</Text>
      <Text as="p" variant="bodyMd">
        We'll discover the best keywords for your website and create optimized blog content to boost your search rankings.
      </Text>

      {/* Current Plan Badge */}
      <Badge tone={isPaidPlan ? "success" : "info"}>
        {`Current Plan: ${displayPlan.charAt(0).toUpperCase() + displayPlan.slice(1)}`}
      </Badge>

      {/* Plan Comparison Table */}
      <div style={{
        border: '1px solid #e1e1e1',
        borderRadius: '8px',
        padding: '1rem',
        fontSize: '14px',
        overflow: 'hidden'
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid #e1e1e1', width: '40%' }}>Feature</th>
              <th style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #e1e1e1', width: '20%' }}>Free</th>
              <th style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #e1e1e1', width: '20%' }}>Starter</th>
              <th style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #e1e1e1', width: '20%' }}>Pro</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ backgroundColor: displayPlan === 'free' ? '#f0f0f0' : 'transparent' }}>
              <td style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>LLM Optimization</td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>✅</td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>✅</td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>✅</td>
            </tr>
            <tr style={{ backgroundColor: displayPlan === 'starter' || displayPlan === 'pro' ? '#f0f0f0' : 'transparent' }}>
              <td style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>All LLM Optimization</td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>✗</td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>{isPaidPlan && displayPlan === 'starter' ? '✅' : '⏳'}</td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>{isPaidPlan && displayPlan === 'pro' ? '✅' : '⏳'}</td>
            </tr>
            <tr>
              <td style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>Finding Best Keywords</td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>{displayPlan === 'free' && wizardState.keywordsFound ? '✅' : '⏳'}</td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>{displayPlan === 'starter' && wizardState.keywordsFound ? '✅' : '⏳'}</td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>{displayPlan === 'pro' && wizardState.keywordsFound ? '✅' : '⏳'}</td>
            </tr>
            <tr>
              <td style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>Initial Blog Generation</td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>{displayPlan === 'free' && wizardState.firstBlogGenerated ? '✅' : '⏳'}</td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>{displayPlan === 'starter' && wizardState.firstBlogGenerated ? '✅' : '⏳'}</td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>{displayPlan === 'pro' && wizardState.firstBlogGenerated ? '✅' : '⏳'}</td>
            </tr>
            <tr>
              <td style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>Auto Blog Generation</td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>{displayPlan === 'free' && wizardState.automationEnabled ? '✅1/week' : '1/week'}</td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>{displayPlan === 'starter' && wizardState.automationEnabled ? '✅2/week' : '2/week'}</td>
              <td style={{ textAlign: 'center', padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>{displayPlan === 'pro' && wizardState.automationEnabled ? '✅5/week' : '5/week'}</td>
            </tr>
            <tr style={{ backgroundColor: displayPlan === 'free' ? '#f0f0f0' : displayPlan === 'starter' ? '#f0f0f0' : displayPlan === 'pro' ? '#f0f0f0' : 'transparent' }}>
              <td style={{ padding: '8px 12px' }}>Price</td>
              <td style={{ textAlign: 'center', padding: '8px 12px' }}>FREE</td>
              <td style={{ textAlign: 'center', padding: '8px 12px' }}>$4.99/mo</td>
              <td style={{ textAlign: 'center', padding: '8px 12px' }}>$9.99/mo</td>
            </tr>
          </tbody>
        </table>
      </div>

      {wizardState.error ? (
        <BlockStack gap="300" align="center">
          <Text as="p" variant="bodyMd" tone="critical">❌ Setup Failed</Text>
          <Text as="p" variant="bodySm" tone="critical">
            {wizardState.error}
          </Text>
          <Button
            variant="primary"
            onClick={() => {
              setWizardState(prev => ({ ...prev, error: null }));
              handleStartBlogGeneration();
            }}
          >
            Try Again
          </Button>
        </BlockStack>
      ) : wizardState.isBlogGenerating ? (
        <BlockStack gap="300" align="center">
          <Spinner size="large" />
          <Text as="p" variant="bodyMd">🎯 Setting Up Your Blog System...</Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {wizardState.currentOperation}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            This may take 30-60 seconds...
          </Text>
        </BlockStack>
      ) : wizardState.showSuccess ? (
        <BlockStack gap="400" align="center">
          <div style={{
            fontSize: '48px',
            textAlign: 'center',
            marginBottom: '1rem'
          }}>
            🎉
          </div>
          <Text as="h3" variant="headingLg" tone="success">
            Success! Setup Complete!
          </Text>
          <BlockStack gap="200" align="center">
            <Text as="p" variant="bodyMd" tone="success">
              ✅ Keywords discovered and saved
            </Text>
            <Text as="p" variant="bodyMd" tone="success">
              ✅ First SEO blog post created
            </Text>
            <Text as="p" variant="bodyMd" tone="success">
              ✅ Weekly automation enabled
            </Text>
          </BlockStack>
          <Text as="p" variant="bodySm" tone="subdued">
            Your AEO improvements are now active and working!
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Closing wizard in {wizardState.autoCloseTimer} seconds...
          </Text>
        </BlockStack>
      ) : wizardState.blogsCompleted ? (
        <BlockStack gap="300" align="center">
          <Text as="p" variant="bodyMd" tone="success">✅ Blog System Configured!</Text>
          <Text as="p" variant="bodySm" tone="subdued">
            🎉 Setup Complete! Your AEO improvements are now active.
          </Text>
        </BlockStack>
      ) : (
        <Button
          variant="primary"
          size="large"
          onClick={handleStartBlogGeneration}
        >
          Start Blog Generation
        </Button>
      )}
    </BlockStack>
    );
  };

  const renderProgressSteps = () => (
    <InlineStack gap="200" align="center">
      <Badge tone={wizardState.currentStep >= 1 ? "success" : "info"}>
        {`${wizardState.currentStep > 1 ? "✅" : "1"} AEO`}
      </Badge>
      <Text as="span" variant="bodySm" tone="subdued">→</Text>
      <Badge tone={wizardState.currentStep >= 2 ? "success" : wizardState.currentStep === 2 ? "info" : "info"}>
        {`${wizardState.currentStep > 2 ? "✅" : "2"} Plan`}
      </Badge>
      <Text as="span" variant="bodySm" tone="subdued">→</Text>
      <Badge tone={wizardState.currentStep >= 3 ? "info" : "info"}>
        {`3 Blogs`}
      </Badge>
    </InlineStack>
  );

  return (
    <>
      {/* Background Overlay */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        zIndex: 999,
        pointerEvents: 'none'
      }} />

      {/* Wizard Card in Bottom Right */}
      <div style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        zIndex: 1000,
        width: '650px',
        maxHeight: '100vh',
        overflow: 'auto'
      }}>
        <Card>
          <BlockStack gap="400">
            {/* Progress Steps */}
            <div style={{ textAlign: 'center' }}>
              {renderProgressSteps()}
            </div>

            {/* Current Step Content */}
            {wizardState.currentStep === 1 && renderStep1()}
            {wizardState.currentStep === 2 && renderStep2()}
            {wizardState.currentStep === 3 && renderStep3()}

            {/* Footer Actions */}
            <InlineStack gap="200" align="space-between">
              <Button size="slim" onClick={onSkip}>
                Skip Wizard
              </Button>
              <Text as="p" variant="bodySm" tone="subdued">
                Step {wizardState.currentStep} of 3
              </Text>
            </InlineStack>
          </BlockStack>
        </Card>
      </div>
    </>
  );
}