// Chapters 1-4: Executive Summary, Current State, Blocker 1 (Data Layer), Blocker 2 (Tenancy)
const { para, h1, h2, tableCaption, bizTable } = require("./helpers");

const c = [];

// ═══════════════ 1. EXECUTIVE SUMMARY ═══════════════
c.push(h1("Executive Summary"));

c.push(para([
  { text: "GAVEL is a working forensic reconciliation platform: the intake-to-review loop runs end to end, the reconciliation engine is deterministic and idempotent, every mutation is audit-logged, and the test harness (199 unit tests, 78 live API assertions, and four end-to-end verification suites) runs green on every push. " },
  { text: "It is ready to demonstrate today. It is not yet ready to run inside a company that relies on it for money decisions.", bold: true },
]));

c.push(para([
  { text: "This plan addresses every blocker between the current state and deployment to real companies and organisations. It was prepared with one governing constraint, stated by the product owner and treated here as a design requirement: " },
  { text: "GAVEL will be used by actual organisations to manage their expenses, so there must be no margin for error.", italics: true },
  { text: " That constraint converts what would otherwise be routine hardening work into a financial-grade correctness programme, and it is treated as a first-class blocker (Blocker 4) rather than a footnote." },
]));

c.push(para([
  { text: "Seven blockers are identified and each receives a full architecture-level plan: the SQLite data layer, the absence of tenant isolation, the lack of a user provisioning path, financial-grade correctness, demo-grade ingestion, missing production operations discipline, and engine confidence governance. The strategy is deliberately " },
  { text: "hybrid", bold: true },
  { text: ": the first paying pilots run on dedicated single-tenant deployments (one database per customer organisation), while the schema and access layer are built now to graduate to shared multi-tenant infrastructure later without a rewrite. Sequencing is dependency-ordered in four phases, P0 through P3, with explicit go/no-go gates and no calendar commitments; a compliance module maps DPDP (India), GDPR, and SOC 2 obligations onto GAVEL's actual data flows." },
]));

c.push(para([
  { text: "The verdict, stated up front: " },
  { text: "readiness is earned phase by phase.", bold: true },
  { text: " P0 (managed PostgreSQL, real secrets management, and a working provisioning path) converts the sandbox into a pilot-grade deployment for one organisation. P1 (append-only audit enforcement, dual control on money-moving findings, and executable financial invariants) earns the zero-error bar. P2 (tenant scoping enforced in the data access layer, session hardening, externalised rate limits) makes the second customer safe. P3 (native connectors and the confidence calibration loop) is where the product becomes operationally embeddable in a customer's finance workflow rather than a periodic audit exercise." },
]));

// ═══════════════ 2. CURRENT STATE ASSESSMENT ═══════════════
c.push(h1("Current State Assessment: What Works and What Blocks Deployment"));

c.push(h2("Verified strengths the plan builds on"));
c.push(para([
  { text: "An honest deployment plan must start from what is genuinely solid, because none of it should be rebuilt. The authentication stack is real rather than ceremonial: scrypt password hashing, HS256 JSON Web Tokens in httpOnly SameSite=Strict cookies, middleware-stamped identity that cannot be spoofed by client-supplied headers, role-based access control across viewer, reviewer, and admin tiers, and sliding-window login rate limiting keyed by both IP and email address. Every mutating route writes to an immutable audit log with actor, action, entity, request identifier, and timestamp, which is the raw material a SOC 2 assessor will ask for." },
]));

c.push(para([
  { text: "The financial data model is already correct in the way that matters most: every currency field in the Prisma schema is Decimal(14,2), never Float, and monetary aggregation routes through Decimal.js accumulation with conversion only at the API boundary inside the IEEE-754 safe bound. The reconciliation engine is deterministic and idempotent, with signature-based deduplication so that re-running a reconciliation never double-counts findings. The ingestion path validates row by row in dry-run mode before any write, and the CI pipeline runs lint, typecheck, the unit suite, and a production build on every push. These properties are prerequisites for everything in this plan, and they already exist." },
]));

c.push(h2("The blocker inventory"));
c.push(para([
  { text: "The table below is the complete inventory of what stands between the current build and an organisational deployment. Severity reflects the consequence of deploying without fixing the blocker, not the difficulty of fixing it. Every item is addressed by a dedicated chapter; the phase that resolves each one is noted for cross-reference with the sequencing chapter." },
]));

c.push(tableCaption("Table 1: Deployment blocker inventory"));
c.push(bizTable([
  ["Blocker", "Current state", "Risk if deployed as-is", "Resolved in"],
  ["1. Data layer", "SQLite, single file, schema applied by db push, no migration history", "No managed backups or point-in-time recovery; no concurrency; schema drift untracked", "P0"],
  ["2. Tenant isolation", "Tenant model exists but dormant; tenantId optional on User only; no query scoping", "Any future multi-customer consolidation requires a rewrite; shared deployments leak data", "P2 (schema in P0)"],
  ["3. User provisioning", "Three hardcoded demo users; no invite, reset, or verification flows", "No way to onboard a real organisation; credentials managed by hand", "P0"],
  ["4. Financial-grade correctness", "Audit log immutable by convention only; single-reviewer approvals; LLM output enters findings after human review but without structural validation gates", "A silent error or an unauthorised edit can propagate into money decisions with no compensating control", "P1"],
  ["5. Evidence ingestion", "Manual CSV/JSON upload, 2 MB and 2,500-row caps", "Pilot depends on customers exporting and uploading files by hand; no provenance chain beyond upload", "P3 (hardening in P1)"],
  ["6. Production operations", "Dev-secret fallback warns; no migrations in CI; in-memory rate limiter; logs without metrics or alerting", "Undetectable failures; unrecoverable data loss; secrets on laptops", "P0-P2"],
  ["7. Engine confidence governance", "Hand-tuned weights, documented but uncalibrated; fuzzy entity links capped but unreviewed", "Plausible-sounding findings at the wrong confidence level erode the trust the product sells", "P3"],
], [16, 30, 38, 16]));

c.push(para([
  { text: "A scope boundary for this document: it is an engineering deployment plan, not a product or go-to-market strategy. Pricing, positioning, and sales motions are out of scope, and where a decision depends on the first pilot customer's technology stack (most acutely for connector priority in Blocker 5), the plan states the dependency explicitly rather than assuming an answer." },
]));

// ═══════════════ 3. BLOCKER 1: DATA LAYER ═══════════════
c.push(h1("Blocker 1: Data Layer - From SQLite to Managed PostgreSQL"));

c.push(h2("Why this is the first domino"));
c.push(para([
  { text: "SQLite is the right database for the sandbox and the wrong one for an organisational deployment, for reasons that are structural rather than performance-related. The production database is a single file on one machine: every backup is a file copy with no point-in-time recovery, a corrupted page cannot be rolled back to a consistent state mid-day, and the concurrency model serialises writers in ways that surface as opaque failures under real multi-user load. Just as significantly for the zero-error bar, the schema is applied with " },
  { text: "prisma db push", bold: true },
  { text: ", which produces no migration history; there is no artifact that records what the production schema has actually been through, and therefore no way to reason about rollback. The schema file itself already anticipates the move: its header notes that production should switch to PostgreSQL with pgvector, and the Decimal columns store as NUMERIC there rather than TEXT." },
]));

c.push(h2("Provider selection and topology"));
c.push(para([
  { text: "The plan targets managed PostgreSQL as the foundation for the hybrid topology: Neon, Supabase, or Amazon RDS for the first customers, chosen on four criteria rather than brand. First, branch-on-demand or cheap database cloning matters because single-tenant pilots each need an isolated database, and creating one must be an API call rather than a provisioning project. Second, point-in-time recovery must be included, not an add-on, because it is the recovery backbone of Blocker 6. Third, connection pooling must be supported (Neon and Supabase pool natively; RDS wants PgBouncer in front) because serverless-style compute opens connections faster than PostgreSQL accepts them. Fourth, a free or near-free tier keeps pilot economics sane; all three candidates qualify at pilot scale." },
]));

c.push(para([
  { text: "For the pilot phase, each customer organisation receives a dedicated database on the same provider account, deployed by script. This is the single-tenant half of the hybrid strategy: isolation by construction, no query-level tenant filtering to get wrong, and per-customer restore capability. The graduation path to shared infrastructure is the subject of Blocker 2, and the decision to defer it is explicit: row-level multi-tenancy is a correctness-critical feature that should not be load-bearing during the first deployments." },
]));

c.push(h2("Migration mechanics and discipline"));
c.push(para([
  { text: "The mechanical migration is small because Prisma abstracts the dialect: flip the provider to postgresql, regenerate the client, and run the first migration to establish the baseline schema in an empty database, then load pilot data through the existing idempotent ingestion paths rather than by copying SQLite files. The discipline that must be established alongside is larger: " },
  { text: "prisma migrate dev", bold: true },
  { text: " becomes the only way schemas change, " },
  { text: "migrate deploy", bold: true },
  { text: " runs in CI/CD as a gated step before the application rolls, and every schema change follows the expand-contract pattern (add the new column and dual-write, backfill, then remove the old path in a later deploy) so that a rollback never requires a database rollback. Migration files are committed, reviewed, and treated as production artifacts with the same seriousness as source code." },
]));

c.push(para([
  { text: "One SQLite-era behaviour needs deliberate replacement: the sandbox self-heal and Reset demo paths recreate the demo dataset by wiping tables. In production neither path exists (both are already hard-gated to non-production environments), and the operational equivalent is environment recreation from migration plus seed, which should be rehearsed as part of the P0 gate. The existing end-to-end verification suites, which already prove login, reconciliation, and ingestion against a running server, are the acceptance tests for the migrated stack; they run unchanged against PostgreSQL, which is itself evidence that the migration is complete." },
]));

// ═══════════════ 4. BLOCKER 2: TENANT ISOLATION ═══════════════
c.push(h1("Blocker 2: Tenant Isolation and the Organisation Model"));

c.push(h2("The dormant Tenant model and the hybrid decision"));
c.push(para([
  { text: "The schema already contains a Tenant entity with a name, a unique slug, and a users relation, and User carries a nullable tenantId. It is dormant: no query filters by tenant, and every business table (Client, Contract, Project, Finding, Invoice, and the rest of the evidence chain) lacks a tenant column entirely. The hybrid strategy decided for this plan is to treat that dormant model as the seed of a graduation path: " },
  { text: "the first customers run single-tenant (one database per organisation, isolation by construction), while the schema and data-access layer are made multi-tenant-ready now", bold: true },
  { text: ", so that consolidating customers onto shared infrastructure later is a deployment change plus a data move, not a rewrite." },
]));

c.push(h2("What multi-tenant-ready means in the schema"));
c.push(para([
  { text: "Every organisation-scoped table gains a non-nullable tenantId foreign key with an index, in P0, while the deployment remains single-tenant and the column is written with the deploying organisation's tenant id. The cost of doing this early is one column and one index per table; the cost of doing it late is a coordinated data migration under customer load, which is exactly the kind of change that violates the zero-error bar. Unique constraints that are currently global (a client name, an invoice number, an external ticket identifier) become composite unique constraints keyed with tenantId, so that two organisations can legitimately have a client with the same name without colliding. The audit log is deliberately not tenant-scoped in the shared model: it is append-only, org-wide from the operator's perspective, and per-tenant views are a filtering concern, not a storage concern." },
]));

c.push(h2("Enforcement in the data-access layer"));
c.push(para([
  { text: "Columns alone do not isolate anything; queries do. The enforcement mechanism is a Prisma client extension installed once per request context: it reads the verified tenant id from middleware-stamped headers (the same mechanism that already carries the verified actor), injects tenantId into every create, and rejects or scopes every read and update against tenant-scoped models. Because the extension lives at the client boundary, route handlers cannot bypass it by accident; bypassing it requires a deliberate escape hatch. The plan requires an explicit escape-hatch register: every query that legitimately crosses tenants (operator dashboards, cross-org aggregation if ever needed) is listed, justified, and reviewed, and the register is empty in the pilot phase. The test strategy mirrors the proven login-drift guard pattern already in the suite: a unit test walks the route surface and fails if any organisation-scoped model is reachable without tenant context, so an unscoped query cannot silently ship." },
]));

c.push(para([
  { text: "The consolidation decision, when it comes, is triggered by economics rather than ambition: when the per-customer cost of separate databases (provider fees, deployment overhead, per-tenant upgrade coordination) exceeds the engineering cost of trusting the scoping layer, shared infrastructure becomes rational. The gate for that transition is a penetration-style review of the enforcement layer plus a load test of the composite indexes, and until both pass, single-tenant remains the default for every new customer. This keeps the isolation guarantee a property of infrastructure during the phase when a single data leak would end the company." },
]));

module.exports = c;
