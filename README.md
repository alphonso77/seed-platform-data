# Seed Platform Data

CLI + web UI for seeding realistic test data into HubSpot, Stripe, and Shopify sandbox environments.

Built to prove out platform integrations without polluting production data. Includes safety guards that block operations against live/production environments.

## Quickstart

### Prerequisites

- Node.js >= 20
- Platform sandbox credentials (at least one):
  - **Stripe**: Test secret key (`sk_test_...`)
  - **HubSpot**: Developer test portal access token
  - **Shopify**: Development store domain + access token

### Install

```bash
npm install
cd frontend && npm install && cd ..
```

### Configure

```bash
cp .env.example .env
```

Edit `.env` with your sandbox credentials:

```
STRIPE_SECRET_KEY=sk_test_your_key_here
HUBSPOT_ACCESS_TOKEN=your_hubspot_token_here
SHOPIFY_STORE_DOMAIN=your-dev-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=your_shopify_token_here
DEFAULT_EMAIL_DOMAINS=fratellisoftware.com
```

See [Platform Credentials & Permissions](#platform-credentials--permissions) below for details on how to create credentials and what scopes are required.

### Run (CLI)

```bash
# Interactive menu
npm run cli

# Single commands (AI-friendly)
npm run cli -- seed stripe --size medium
npm run cli -- seed hubspot --size small --domains fratellisoftware.com
npm run cli -- clean stripe
npm run cli -- status
npm run cli -- validate shopify
```

### Run (Web UI)

```bash
# Development (backend + frontend with hot reload)
npm run dev:all

# Then open http://localhost:5172
```

The backend listens on `PORT` from `.env` (default `3000`). The Vite dev server reads the same value to target its `/api` proxy, so changing `PORT` in `.env` is enough — no need to edit the Vite config.

### Run (Docker)

```bash
docker-compose up
# Opens on http://localhost:3000
```

---

## CLI Reference

### `seed <platform>`

Seed test data into a platform sandbox.

```bash
npm run cli -- seed <stripe|hubspot|shopify> [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-s, --size <size>` | Dataset size: `small`, `medium`, `large` | `small` |
| `-d, --domains <domains>` | Comma-separated email domains | from `.env` |
| `-r, --random-domains` | Generate `{uuid}.example.com` addresses | `false` |
| `--dry-run` | Preview without creating data | `false` |

### `clean <platform>`

Remove previously seeded data (identified by `_seeded` metadata tag).

```bash
npm run cli -- clean <stripe|hubspot|shopify> [--dry-run]
```

### `status [platform]`

Check connection status for one or all platforms.

```bash
npm run cli -- status          # All platforms
npm run cli -- status stripe   # Single platform
```

### `validate <platform>`

Verify a platform environment is a sandbox (not production).

```bash
npm run cli -- validate stripe
```

### `interactive`

Launch the interactive menu (also the default when no command is given).

```bash
npm run cli
```

---

## Dataset Sizes

| Size | Contacts | Products | Orders |
|------|----------|----------|--------|
| Small | 25 | 5 | 10 |
| Medium | 250 | 25 | 100 |
| Large | 2,500 | 100 | 1,000 |

---

## What Gets Seeded

The "Contacts / Products / Orders" counts above describe the *generic* dataset. Each platform maps these to its own object model and may create additional records as needed.

### Stripe

| Generic | Stripe object(s) created |
|---------|--------------------------|
| Contact | `Customer` |
| Product | `Product` + one `Price` per product |
| Order | `Invoice` (finalized to `open` status) + one `InvoiceItem` per line |

Notes:
- Invoices are finalized, not left as drafts — Stripe's API blocks deletion of finalized invoices, so the cleaner voids them instead. Voided invoices remain in Stripe as historical records but don't appear in customer-facing reports.
- Products are archived (`active: false`) on clean rather than deleted, since Stripe doesn't allow deleting products that have ever been used in invoices.

### HubSpot

| Generic | HubSpot object(s) created |
|---------|---------------------------|
| Contact | `Contact` |
| Contact (deduplicated by `company` name) | `Company` — explicitly created via the API, one per unique `faker.company.name()` value across contacts |
| Order | `Deal` (named `Seed Order - {firstName} {lastName}`, stage `closedwon` or `appointmentscheduled`) |

Notes:
- The seeder creates two custom properties (`_seeded`, `_seeded_at`) on contacts, companies, and deals. These are reused across runs (created idempotently) and are how the cleaner finds seeded records.
- **HubSpot also auto-creates companies as a side effect of contact creation** when *Settings → Objects → Companies → Automatically create and associate companies with contacts* is enabled in your portal. Those auto-created companies are NOT tagged by us, so the cleaner can't see them — they accumulate as empty/no-name companies after each clean. To avoid this, either disable that setting in your sandbox or manually purge the no-name companies via the HubSpot UI after a clean.

### Shopify

| Generic | Shopify object(s) created |
|---------|---------------------------|
| Contact | `Customer` |
| Product | `Product` (with one default `Variant` containing price + SKU) |
| Order | `DraftOrder` |

Notes:
- Orders are created as draft orders, not completed orders — completing an order requires a payment flow that's not appropriate for seeded test data.

---

## Email Generation

Three modes for generating email addresses on seeded contacts:

1. **Custom domains** — provide one or more domains via `--domains` or `DEFAULT_EMAIL_DOMAINS` env var. Contacts are distributed round-robin: `firstname.lastname@yourdomain.com`
2. **Random domains** — use `--random-domains` flag. Generates `firstname.lastname@{uuid}.example.com` using RFC 2606 reserved domains (guaranteed non-deliverable).
3. **Mixed** — provide custom domains and also set `--random-domains` for overflow.

Collision avoidance appends a random 3-digit suffix when names would collide.

---

## Platform Credentials & Permissions

### Stripe

Use a **test mode** secret key (starts with `sk_test_`). You can create one in the [Stripe Dashboard](https://dashboard.stripe.com/test/apikeys).

For a restricted key, enable these resource permissions:

| Resource | Permission |
|----------|------------|
| Customers | Read + Write |
| Products | Read + Write |
| Prices | Read + Write |
| Invoices | Read + Write |
| Invoice Items | Read + Write |
| Balance | Read |

A standard test secret key (`sk_test_`) has full access and works without configuring individual permissions.

### HubSpot

Create a **developer test account** at [HubSpot Developer](https://developers.hubspot.com/) and generate a private app access token with these OAuth scopes:

| Scope | Purpose |
|-------|---------|
| `crm.objects.contacts.read` | Read contacts for clean operations |
| `crm.objects.contacts.write` | Create and archive contacts |
| `crm.objects.companies.read` | Read companies for clean operations |
| `crm.objects.companies.write` | Create and archive companies |
| `crm.objects.deals.read` | Read deals for clean operations |
| `crm.objects.deals.write` | Create and archive deals |
| `crm.schemas.contacts.write` | Create custom properties on contacts |
| `crm.schemas.companies.write` | Create custom properties on companies |
| `crm.schemas.deals.write` | Create custom properties on deals |
| `oauth` | Access account info (sandbox detection) |

The account type must be `DEVELOPER_TEST` or `SANDBOX` — production portals are blocked.

### Shopify

Create a **development store** from your [Shopify Partner Dashboard](https://partners.shopify.com/) and create a custom app with these access scopes:

| Scope | Purpose |
|-------|---------|
| `read_customers` | Read customers for clean operations |
| `write_customers` | Create and delete customers |
| `read_products` | Read products for clean operations |
| `write_products` | Create and delete products |
| `read_draft_orders` | Read draft orders for clean operations |
| `write_draft_orders` | Create and delete draft orders |

The store must be on a `partner_test` or `affiliate` plan (development stores). Production stores are blocked.

---

## Safety Guards

Every seed and clean operation validates the target environment before executing. Operations are **hard-blocked** against production environments — there is no override flag.

| Platform | Sandbox Detection |
|----------|-------------------|
| Stripe | API key must start with `sk_test_` |
| HubSpot | Account type must be `DEVELOPER_TEST` or `SANDBOX` |
| Shopify | Store must be a `.myshopify.com` development store |

---

## API Endpoints

The web server exposes these endpoints (used by the React frontend):

```
GET  /api/health                         Health check
GET  /api/platforms                      List platforms with connection status
GET  /api/platforms/:platform/status     Single platform status
POST /api/platforms/:platform/validate   Check sandbox safety
POST /api/platforms/:platform/seed       Seed data (body: SeedOptions)
POST /api/platforms/:platform/clean      Clean seeded data (body: CleanOptions)
```

---

## Seeded Data Tracking

All seeded records are tagged so they can be identified and cleaned up:

| Platform | Tracking Method |
|----------|----------------|
| Stripe | `metadata: { _seeded: "true", _seeded_at: "<timestamp>" }` |
| HubSpot | Custom properties: `_seeded = "true"`, `_seeded_at = "<timestamp>"` |
| Shopify | Tags: `_seeded`, `_seeded_at:<timestamp>` |

The `clean` command uses these tags to find and remove only seeded data.

---

## Development

```bash
# Type check
npm run typecheck

# Lint
npm run lint

# Tests
npm test

# Build (backend)
npm run build

# Build (frontend)
npm run build:frontend
```

---

## Tech Stack

- **Backend**: Node.js, TypeScript, Express, Zod, Winston
- **Frontend**: React 19, Vite, Tailwind CSS 4, TanStack React Query
- **CLI**: Commander.js, Inquirer.js, Chalk, Ora
- **Data**: @faker-js/faker
- **Platforms**: stripe SDK, @hubspot/api-client, @shopify/shopify-api
- **Testing**: Mocha + Chai
