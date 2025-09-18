import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useFetcher, useSearchParams } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  Badge,
  List,
  InlineStack,
  Box,
  ProgressBar,
  Banner,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { BillingService, type PlanType } from "../services/billing.service";
import { ShopifyShopService } from "../services/shopify-shop.service";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { admin } = await authenticate.admin(request);
    const shopService = new ShopifyShopService(admin);
    const shopInfo = await shopService.getShopInfo();
    const shopDomain = shopInfo.primaryDomain || 'unknown';

    const billingService = new BillingService(prisma, admin);

    // Get current subscription and usage
    const [subscription, usage, allPlans] = await Promise.all([
      billingService.getSubscription(shopDomain),
      billingService.getUsage(shopDomain),
      Promise.resolve(billingService.getAllPlans())
    ]);

    return json({
      shopInfo,
      subscription,
      usage,
      allPlans,
      error: null
    });
  } catch (error) {
    console.error('Error in billing loader:', error);
    return json({
      shopInfo: null,
      subscription: null,
      usage: null,
      allPlans: null,
      error: 'Failed to load billing information'
    });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const actionType = formData.get('actionType');
  const plan = formData.get('plan') as PlanType;

  try {
    const { admin } = await authenticate.admin(request);
    const shopService = new ShopifyShopService(admin);
    const shopInfo = await shopService.getShopInfo();
    const shopDomain = shopInfo.primaryDomain || 'unknown';

    const billingService = new BillingService(prisma, admin);

    if (actionType === 'subscribe') {
      if (plan !== 'starter' && plan !== 'pro') {
        return json({ success: false, error: 'Invalid plan selected' });
      }

      const result = await billingService.createSubscription(shopDomain, plan);

      if (result.success && result.confirmationUrl) {
        // Redirect to Shopify's confirmation page
        return redirect(result.confirmationUrl);
      }

      return json(result);
    }

    if (actionType === 'cancel') {
      const result = await billingService.cancelSubscription(shopDomain);
      return json(result);
    }

    if (actionType === 'confirm') {
      // Handle return from Shopify confirmation
      const url = new URL(request.url);
      const chargeId = url.searchParams.get('charge_id');

      if (chargeId) {
        // Update subscription status to active
        await billingService.updateSubscriptionStatus(chargeId, 'active');
        return redirect('/app/billing?confirmed=true');
      }

      return json({ success: false, error: 'No charge ID provided' });
    }

    return json({ success: false, error: 'Invalid action type' }, { status: 400 });

  } catch (error) {
    console.error('Error in billing action:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'An unexpected error occurred'
    });
  }
};

function Billing() {
  const { shopInfo, subscription, usage, allPlans, error: loaderError } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [searchParams] = useSearchParams();

  const isLoading = fetcher.state === "submitting";
  const actionData = fetcher.data;
  const confirmed = searchParams.get('confirmed') === 'true';

  const [showNotification, setShowNotification] = useState(false);

  useEffect(() => {
    if (confirmed) {
      setShowNotification(true);
      // Clear the URL parameter
      window.history.replaceState({}, '', '/app/billing');
    }
  }, [confirmed]);

  useEffect(() => {
    if (actionData && !actionData.success) {
      console.error('Billing action error:', actionData.error);
    }
  }, [actionData]);

  if (loaderError) {
    return (
      <Page>
        <TitleBar title="Billing & Plans" />
        <Text as="p" variant="bodyMd" tone="critical">
          Error: {loaderError}
        </Text>
      </Page>
    );
  }

  if (!subscription || !usage || !allPlans) {
    return (
      <Page>
        <TitleBar title="Billing & Plans" />
        <Text as="p" variant="bodyMd">Loading billing information...</Text>
      </Page>
    );
  }

  const currentPlan = subscription.plan;
  const currentPlanConfig = allPlans[currentPlan];
  const usagePercentage = (usage.blogsGenerated / usage.blogLimit) * 100;

  const getPlanBadgeColor = (plan: PlanType) => {
    switch (plan) {
      case 'free': return 'info';
      case 'starter': return 'warning';
      case 'pro': return 'success';
      default: return 'info';
    }
  };

  const handleSubscribe = (plan: PlanType) => {
    fetcher.submit({ actionType: 'subscribe', plan }, { method: 'POST' });
  };

  const handleCancel = () => {
    if (confirm('Are you sure you want to cancel your subscription? You will be downgraded to the free plan.')) {
      fetcher.submit({ actionType: 'cancel' }, { method: 'POST' });
    }
  };

  return (
    <Page>
      <TitleBar title="Billing & Plans" />

      <Layout>
        <Layout.Section>
          {showNotification && (
            <Banner
              title="Subscription Confirmed!"
              tone="success"
              onDismiss={() => setShowNotification(false)}
            >
              <p>Your subscription has been successfully activated. You can now enjoy your new plan features!</p>
            </Banner>
          )}

          {actionData && !actionData.success && (
            <Banner
              title="Error"
              tone="critical"
            >
              <p>{actionData.error}</p>
            </Banner>
          )}

          {/* Current Plan & Usage */}
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingLg">
                    Current Plan
                  </Text>
                  <Badge tone={getPlanBadgeColor(currentPlan)}>
                    {currentPlanConfig.name}
                  </Badge>
                </InlineStack>

                <Text as="p" variant="bodyMd" tone="subdued">
                  Store: {shopInfo?.primaryDomain}
                </Text>
              </BlockStack>

              <Divider />

              {/* Usage Stats */}
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  This Week's Usage
                </Text>

                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text as="p" variant="bodyMd">
                      Blog Generations
                    </Text>
                    <Text as="p" variant="bodyMd" fontWeight="bold">
                      {usage.blogsGenerated} / {usage.blogLimit}
                    </Text>
                  </InlineStack>

                  <ProgressBar
                    progress={usagePercentage}
                    tone={usagePercentage >= 100 ? "critical" : usagePercentage >= 80 ? "warning" : "success"}
                  />

                  {usage.blogsGenerated >= usage.blogLimit && (
                    <Text as="p" variant="bodySm" tone="critical">
                      ⚠️ You've reached your weekly blog limit. Upgrade to generate more blogs.
                    </Text>
                  )}
                </BlockStack>

                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd">
                    Auto LLMs.txt Generation
                  </Text>
                  <Text as="p" variant="bodySm" tone={usage.canGenerateLlms ? "success" : "subdued"}>
                    {usage.canGenerateLlms ? "✅ Enabled (Pro plan feature)" : "❌ Not available (Pro plan only)"}
                  </Text>
                </BlockStack>
              </BlockStack>
            </BlockStack>
          </Card>

          {/* Available Plans */}
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingLg">
                Available Plans
              </Text>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
                {Object.entries(allPlans).map(([planKey, planConfig]) => {
                  const plan = planKey as PlanType;
                  const isCurrentPlan = plan === currentPlan;
                  const isPaidPlan = plan !== 'free';

                  return (
                    <Card key={plan} background={isCurrentPlan ? "bg-surface-selected" : undefined}>
                      <BlockStack gap="300">
                        <InlineStack align="space-between">
                          <Text as="h3" variant="headingMd">
                            {planConfig.name}
                          </Text>
                          {isCurrentPlan && (
                            <Badge tone="info">Current</Badge>
                          )}
                        </InlineStack>

                        <Text as="p" variant="headingLg">
                          {plan === 'free' ? 'Free' : `$${planConfig.price}/month`}
                        </Text>

                        <List type="bullet">
                          {planConfig.features.map((feature, index) => (
                            <List.Item key={index}>{feature}</List.Item>
                          ))}
                        </List>

                        <Box paddingBlockStart="300">
                          {isCurrentPlan ? (
                            <InlineStack gap="200">
                              <Text as="p" variant="bodySm" tone="subdued">
                                This is your current plan
                              </Text>
                              {isPaidPlan && (
                                <Button
                                  variant="plain"
                                  tone="critical"
                                  onClick={handleCancel}
                                  loading={isLoading}
                                >
                                  Cancel Subscription
                                </Button>
                              )}
                            </InlineStack>
                          ) : (
                            <Button
                              variant={plan === 'pro' ? 'primary' : 'secondary'}
                              fullWidth
                              onClick={() => handleSubscribe(plan)}
                              loading={isLoading}
                              disabled={plan === 'free'}
                            >
                              {plan === 'free' ? 'Free Plan' : `Upgrade to ${planConfig.name}`}
                            </Button>
                          )}
                        </Box>
                      </BlockStack>
                    </Card>
                  );
                })}
              </div>
            </BlockStack>
          </Card>

          {/* Billing Information */}
          {subscription.billingOn && (
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  Billing Information
                </Text>
                <Text as="p" variant="bodyMd">
                  Next billing date: {subscription.billingOn.toLocaleDateString()}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Status: {subscription.status}
                </Text>
              </BlockStack>
            </Card>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export default Billing;