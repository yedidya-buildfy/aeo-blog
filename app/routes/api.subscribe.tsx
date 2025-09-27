import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate, STARTER_PLAN, PRO_PLAN } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  console.log(`[SUBSCRIBE ROUTE] Called with method: ${request.method}`);
  const { billing } = await authenticate.admin(request);

  const formData = await request.formData();
  const plan = formData.get('plan') as string;

  console.log(`[SUBSCRIBE ROUTE] Plan: ${plan}, SHOPIFY_APP_URL: ${process.env.SHOPIFY_APP_URL}`);
  console.log(`[SimpleBilling] Requesting payment for plan: ${plan}`);

  if (plan === 'starter') {
    const returnUrl = `${process.env.SHOPIFY_APP_URL}/app/seo-blogs?showWizard=true&step=3&planConfirmed=true`;
    console.log(`[SUBSCRIBE ROUTE] Final returnUrl: ${returnUrl}`);

    // This automatically redirects to Shopify's payment page
    return await billing.request({
      plan: STARTER_PLAN,
      isTest: process.env.NODE_ENV !== 'production',
      returnUrl: returnUrl
    });
  }

  if (plan === 'pro') {
    // This automatically redirects to Shopify's payment page
    return await billing.request({
      plan: PRO_PLAN,
      isTest: process.env.NODE_ENV !== 'production',
      returnUrl: `${process.env.SHOPIFY_APP_URL}/app/seo-blogs?showWizard=true&step=3&planConfirmed=true`
    });
  }

  throw new Error('Invalid plan selected');
};