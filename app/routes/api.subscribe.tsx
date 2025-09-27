import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate, STARTER_PLAN, PRO_PLAN } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing } = await authenticate.admin(request);

  const formData = await request.formData();
  const plan = formData.get('plan') as string;

  console.log(`[SimpleBilling] Requesting payment for plan: ${plan}`);

  if (plan === 'starter') {
    // This automatically redirects to Shopify's payment page
    return await billing.request({
      plan: STARTER_PLAN,
      isTest: process.env.NODE_ENV !== 'production'
    });
  }

  if (plan === 'pro') {
    // This automatically redirects to Shopify's payment page
    return await billing.request({
      plan: PRO_PLAN,
      isTest: process.env.NODE_ENV !== 'production'
    });
  }

  throw new Error('Invalid plan selected');
};