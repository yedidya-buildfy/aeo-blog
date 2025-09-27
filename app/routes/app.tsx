import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError, useFetcher, useNavigate } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { useState, useEffect } from "react";

import { authenticate } from "../shopify.server";
import { ShopifyShopService } from "../services/shopify-shop.service";
import WizardOverlay from "../components/WizardOverlay";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  // Check wizard state - TEMP: Force show wizard for debugging
  const shopService = new ShopifyShopService(admin);
  let wizardState = null;
  try {
    wizardState = await shopService.getWizardState();
  } catch (error) {
    console.log('[DEBUG] Failed to get wizard state, will show wizard:', error);
  }
  const showWizard = true; // TEMP: Always show wizard for debugging

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    showWizard
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get('actionType');

  if (actionType === 'completeWizard') {
    const shopService = new ShopifyShopService(admin);
    const success = await shopService.setWizardState({ completed: true });

    return json({ success });
  }

  return json({ success: false, error: 'Invalid action type' });
};

export default function App() {
  const { apiKey, showWizard } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const [aeoSuccessTriggered, setAeoSuccessTriggered] = useState(false);

  // Listen for messages from child components about AEO success
  useEffect(() => {
    const handleAeoSuccess = () => {
      setAeoSuccessTriggered(true);
    };

    // Listen for custom events from dashboard
    window.addEventListener('aeoSuccess', handleAeoSuccess);

    return () => {
      window.removeEventListener('aeoSuccess', handleAeoSuccess);
    };
  }, []);

  const handleWizardComplete = () => {
    const formData = new FormData();
    formData.append('actionType', 'completeWizard');
    fetcher.submit(formData, { method: 'POST' });
  };

  const handleWizardSkip = () => {
    const formData = new FormData();
    formData.append('actionType', 'completeWizard');
    fetcher.submit(formData, { method: 'POST' });
  };

  const handleNavigateToSEOBlogs = () => {
    navigate('/app/seo-blogs');
  };


  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Home
        </Link>
        <Link to="/app/seo-blogs">
          SEO Blogs
        </Link>
        <Link to="/app/billing">
          Billing & Plans
        </Link>
      </NavMenu>

      {showWizard && (
        <WizardOverlay
          isActive={showWizard}
          onComplete={handleWizardComplete}
          onSkip={handleWizardSkip}
          aeoSuccessTriggered={aeoSuccessTriggered}
          onNavigateToSEOBlogs={handleNavigateToSEOBlogs}
        />
      )}

      <Outlet />
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
