q: i want to add the wizard so when user install my app it will guide him how to activate the app and will only show in the first use how can we do it?

a: 
To show a wizard (onboarding flow) only on the first use after a user installs your Shopify app, you need to:

Detect if the user is opening the app for the first time.
Show the onboarding wizard UI if it's the first use.
Store a flag (e.g., in a metafield or your own database) to indicate onboarding is complete, so the wizard does not show again.
Here’s how you can do this using the Shopify Admin GraphQL API and best practices:

1. Store Onboarding Completion State
Use a shop-level metafield to track whether onboarding is complete. When the user finishes the wizard, set a metafield like onboarding.completed = true.

Mutation to set onboarding as complete:

mutation SetOnboardingComplete {
  metafieldsSet(metafields: [
    {
      namespace: "onboarding"
      key: "completed"
      type: "boolean"
      value: "true"
      ownerId: "gid://shopify/Shop/123456789" # Replace with actual Shop GID
    }
  ]) {
    metafields {
      id
      key
      value
    }
    userErrors {
      field
      message
    }
  }
}

source: https://shopify.dev/docs/api/admin-graphql/latest/mutations/metafieldsSet

2. Check Onboarding State on App Load
When your app loads, query the shop metafield to see if onboarding is complete. If not, show the wizard.

Query to check onboarding state:

query GetOnboardingState {
  shop {
    metafield(namespace: "onboarding", key: "completed") {
      value
    }
  }
}

source: https://shopify.dev/docs/api/admin-graphql/latest/objects/Shop

3. Show the Wizard UI
If the metafield is missing or not "true", show your onboarding wizard UI (built with Polaris/App Bridge).
When the user completes onboarding, call the mutation above to set the metafield.
4. Redirect to Wizard on First Use
After app installation, Shopify redirects the merchant to your app. In your app’s root route, check the onboarding metafield. If onboarding is not complete, render the wizard. Otherwise, show the main app UI.

5. Additional UX Guidance
Provide clear instructions and visuals in your wizard.
You can use theme app extension onboarding guidelines for inspiration on how to guide merchants through activation steps.
Summary
Use a shop metafield to track onboarding completion.
Query the metafield on app load to decide whether to show the wizard.
Set the metafield when onboarding is done.
This ensures the wizard only shows on first use after install.
If you need help with the exact UI code or want to see a full example with Polaris, let me know!

Related resources
To learn more about the resources in the generated operation, refer to these related reference pages:
https://shopify.dev/docs/api/admin-graphql/latest/mutations/metafieldsSet
https://shopify.dev/docs/api/admin-graphql/latest/queries/shop