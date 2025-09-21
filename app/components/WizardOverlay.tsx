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

interface WizardOverlayProps {
  isActive: boolean;
  onComplete: () => void;
  onSkip: () => void;
  aeoSuccessTriggered?: boolean;
  onNavigateToSEOBlogs?: () => void;
  startFromStep?: 1 | 2 | 3;
}

interface WizardState {
  currentStep: 1 | 2 | 3;
  selectedPlan: 'free' | 'starter' | 'pro' | null;
  aeoCompleted: boolean;
  planSelected: boolean;
  blogsCompleted: boolean;
  isAEORunning: boolean;
  isBlogGenerating: boolean;
}

export default function WizardOverlay({ isActive, onComplete, onSkip, aeoSuccessTriggered, onNavigateToSEOBlogs, startFromStep = 1 }: WizardOverlayProps) {
  const [wizardState, setWizardState] = useState<WizardState>({
    currentStep: startFromStep,
    selectedPlan: null,
    aeoCompleted: startFromStep >= 2, // If starting from step 2+, AEO is already complete
    planSelected: false,
    blogsCompleted: false,
    isAEORunning: false,
    isBlogGenerating: false,
  });

  // Listen for AEO success from parent
  useEffect(() => {
    if (aeoSuccessTriggered) {
      setWizardState(prev => ({
        ...prev,
        aeoCompleted: true,
        currentStep: 2
      }));

      // Navigate to SEO blogs page after AEO completion
      if (onNavigateToSEOBlogs) {
        setTimeout(() => {
          onNavigateToSEOBlogs();
        }, 1500); // Small delay to show success message
      }
    }
  }, [aeoSuccessTriggered, onNavigateToSEOBlogs]);

  if (!isActive) return null;

  const handleSelectPlan = (plan: 'free' | 'starter' | 'pro') => {
    setWizardState(prev => ({
      ...prev,
      selectedPlan: plan,
      planSelected: true,
      currentStep: 3
    }));
  };

  const handleStartBlogGeneration = () => {
    setWizardState(prev => ({ ...prev, isBlogGenerating: true }));

    // Simulate blog generation completion
    setTimeout(() => {
      setWizardState(prev => ({
        ...prev,
        isBlogGenerating: false,
        blogsCompleted: true
      }));
      // Complete wizard after blogs are done
      setTimeout(() => {
        onComplete();
      }, 1000);
    }, 4000);
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

  const renderStep2 = () => (
    <BlockStack gap="400">
      <Text as="h2" variant="headingLg">Choose Your AEO Plan</Text>
      <Text as="p" variant="bodyMd" tone="success">✅ AEO Foundation Complete!</Text>

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

  const renderStep3 = () => (
    <BlockStack gap="400">
      <Text as="h2" variant="headingLg">📝 Ready to Generate SEO Blogs?</Text>
      <Text as="p" variant="bodyMd">
        We'll discover the best keywords for your website and create optimized blog content to boost your search rankings.
      </Text>

      {wizardState.selectedPlan && (
        <Badge tone="info">{`Selected: ${wizardState.selectedPlan.charAt(0).toUpperCase() + wizardState.selectedPlan.slice(1)} Plan`}</Badge>
      )}

      {wizardState.isBlogGenerating ? (
        <BlockStack gap="300" align="center">
          <Spinner size="large" />
          <Text as="p" variant="bodyMd">🎯 Setting Up Your Blog System...</Text>
          {wizardState.selectedPlan === 'pro' ? (
            <Text as="p" variant="bodySm" tone="subdued">
              🔄 Generating 10 initial blogs for Pro plan...
            </Text>
          ) : (
            <Text as="p" variant="bodySm" tone="subdued">
              🔄 Creating your first SEO blog...
            </Text>
          )}
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