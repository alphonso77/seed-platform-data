# Detecting a Shopify development store (the right way)

The current safety guard in `src/seeders/shopify-seeder.ts` accepts a store as a sandbox only if `plan_name` is `partner_test` or `affiliate`, or the shop name contains the word "development". This logic is **out of date** — modern Shopify development stores legitimately report `plan_name: 'basic'`, which makes this guard reject real dev stores.

## Why the legacy check fails

Shopify's `plan_name` (REST `/admin/api/.../shop.json`) and `Shop.plan.publicDisplayName` (GraphQL) now reflect the **public billing plan display name** (`Basic`, `Grow`, `Advanced`, `Plus`). It is not a sandbox/production indicator.

A store can simultaneously report:

```jsonc
{
  "plan": {
    "partnerDevelopment": true,    // <- the real signal
    "publicDisplayName": "Basic"   // <- public-facing plan name
  }
}
```

`partnerDevelopment` is the authoritative field for "this is a development store created from a Partner / Dev Dashboard org and may not be transferred to a merchant for production use."

## The correct check

Use the GraphQL Admin API and read `shop.plan.partnerDevelopment`.

### Query

```graphql
query ShopEnvironment {
  shop {
    name
    myshopifyDomain
    plan {
      partnerDevelopment
      shopifyPlus
      publicDisplayName
    }
  }
}
```

### Example response — development store

```json
{
  "data": {
    "shop": {
      "name": "Gmail Tester",
      "myshopifyDomain": "gmail-tester.myshopify.com",
      "plan": {
        "partnerDevelopment": true,
        "shopifyPlus": false,
        "publicDisplayName": "Basic"
      }
    }
  }
}
```

### Example response — production store

```json
{
  "data": {
    "shop": {
      "name": "Real Merchant",
      "myshopifyDomain": "real-merchant.myshopify.com",
      "plan": {
        "partnerDevelopment": false,
        "shopifyPlus": false,
        "publicDisplayName": "Basic"
      }
    }
  }
}
```

Note that `publicDisplayName` is identical in both cases. Only `partnerDevelopment` distinguishes them.

## Recommended logic

```ts
const isSandbox =
  shop.plan.partnerDevelopment === true ||
  shop.plan.publicDisplayName === "Developer Preview" || // Plus partner sandboxes
  // Legacy fallbacks for very old accounts:
  legacyPlanName === "partner_test" ||
  legacyPlanName === "affiliate";
```

Order matters — check `partnerDevelopment` first. The legacy `partner_test` / `affiliate` values still appear on some older accounts, so keep them as fallbacks rather than removing them outright.

## Where to apply this in the codebase

`src/seeders/shopify-seeder.ts` → `validateEnvironment()` (currently around lines 46–77).

Today it issues a REST `client.get({ path: 'shop' })` and inspects `shop.plan_name`. The fix:

1. Switch to the GraphQL client (`new this.shopify.clients.Graphql({ session })`) for this single call, or keep the REST call and add `shop.partner_development` (boolean) which the REST endpoint also exposes — but GraphQL is the documented, supported source of truth.
2. Replace the `planName === 'partner_test' || planName === 'affiliate' || shopName.includes('development')` expression with the logic above.
3. Update the `details` payload in the returned `EnvironmentCheck` to surface `partnerDevelopment` and `publicDisplayName` so the validate command output is informative.

## Temporary override

Until the fix lands, set `SKIP_SANDBOX_CHECK_SHOPIFY=true` in `.env`. This is documented in `CLAUDE.md` and is ignored when `NODE_ENV=production`. Use only when you have manually confirmed via the Dev Dashboard that the store is a development store.

## References

- [Shopify forum — "Development store with Basic plan; how is this possible?"](https://community.shopify.dev/t/development-store-with-basic-plan-how-is-this-possible/31676) — official Shopify staff confirmation that `partnerDevelopment` is the recommended field.
- [GraphQL Admin API — Shop object](https://shopify.dev/docs/api/admin-graphql/latest/objects/Shop)
- [GraphQL Admin API — ShopPlan object](https://shopify.dev/docs/api/admin-graphql/latest/objects/ShopPlan)
