import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError, useFetcher } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";
import { ShopifyShopService } from "../services/shopify-shop.service";
import WizardOverlay from "../components/WizardOverlay";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  // Check wizard state
  const shopService = new ShopifyShopService(admin);
  const wizardState = await shopService.getWizardState();
  const showWizard = !wizardState?.completed;

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
