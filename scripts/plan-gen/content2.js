// Chapters 5-7: Blocker 3 (Identity), Blocker 4 (Financial-grade correctness), Blocker 5 (Ingestion)
const { para, h1, h2, tableCaption, bizTable } = require("./helpers");

const c = [];

// ═══════════════ 5. BLOCKER 3: IDENTITY ═══════════════
c.push(h1("Blocker 3: Identity, Provisioning and Account Lifecycle"));

c.push(h2("The gap: an organisation cannot onboard"));
c.push(para([
  { text: "Today the system knows exactly three users: the demo administrator, reviewer, and viewer, created by the seed with stable identifiers. There is no flow to create an organisation, invite a colleague, reset a forgotten password, verify an email address, or deactivate a departing employee. Every one of those verbs is table stakes for an organisational deployment, and their absence is also a compliance exposure: DPDP and GDPR both expect a defined lifecycle for the accounts that access personal data. The identity stack underneath (scrypt hashing, signed cookies, role gates, rate limiting) is solid, so this blocker is about building the lifecycle on top of it rather than replacing anything." },
]));

c.push(h2("Organisation onboarding and the admin bootstrap"));
c.push(para([
  { text: "The provisioning model is operator-mediated for the pilot phase: a GAVEL operator provisions the organisation (which already exists as the single-tenant database from Blocker 1), creates the first admin account by sending a scoped invitation, and hands over. The invitation is an emailed single-use token bound to the target email address with a short expiry; the recipient sets their own password on redemption, so no password ever travels by email and the operator never sees one. From that point the organisation admin self-serves: they invite users, assign viewer, reviewer, or admin roles, and deactivate leavers. Email verification is enforced at invitation redemption, which is the natural place for it in a B2B tool where addresses are pre-validated by the invitation itself." },
]));

c.push(para([
  { text: "Password reset follows the same single-use-token shape: a request generates a token bound to the account, invalidated by any successful reset and by a second request, with all attempts audit-logged. Session invalidation after a reset is mandatory and is the reason the session model changes in this blocker (below): without server-side session state, telling a compromised account's old sessions to die is impossible." },
]));

c.push(h2("Session hardening and revocation"));
c.push(para([
  { text: "The current token is a stateless seven-day JWT, which is appropriate for a demo and too blunt for an organisation. The hardened model keeps the same signing machinery but splits the lifetime: a short-lived access token (fifteen minutes) plus a server-side session record that the access token references. Revocation becomes a database delete: password reset, account deactivation, and operator-forced sign-out all destroy the session row, and the next access-token refresh fails. The middleware already verifies the signature on every request; it gains one indexed lookup to confirm the session row is alive, mirroring the pattern already proven by the stale-session guard that ships today (which converts a signature-valid token for a deleted user into a clean 401 rather than a foreign-key crash)." },
]));

c.push(para([
  { text: "Multi-factor authentication is scoped to administrators in P2, using time-based one-time passwords (RFC 6198) rather than SMS: the admin tier can approve findings and manage billing evidence, one-factor theft of an admin mailbox should not be enough to reach it, and TOTP has no per-message cost or telecom dependency. Single sign-on is explicitly deferred with a written trigger: the first customer whose security review requires SAML or OIDC integration, at which point an adapter replaces the password path without disturbing the session and role machinery built here." },
]));

c.push(h2("Audit coverage of identity events"));
c.push(para([
  { text: "Every identity event writes to the existing audit log, which already records actor, action, entity, and request identifier: invitations issued and redeemed, role changes, resets requested and completed, deactivations, and forced sign-outs. The audit trail for identity is the artefact a customer's security reviewer asks for first, and it costs nothing new: the logging layer exists, the events simply need to flow through it. A quarterly access review report (who holds which role, last activity, dormant accounts) falls out of the same data with one query and belongs in P2." },
]));

// ═══════════════ 6. BLOCKER 4: FINANCIAL-GRADE CORRECTNESS ═══════════════
c.push(h1("Blocker 4: Financial-Grade Correctness - the Zero-Error Bar"));

c.push(h2("Reading the requirement literally"));
c.push(para([
  { text: "The product owner's constraint - no margin for error in a tool organisations use to manage expenses - is not achievable in the absolute sense that software engineering cannot promise, and an honest plan says so. What is achievable is the standard that bookkeeping and reconciliation systems are held to: " },
  { text: "every number is traceable to its source, every mutation is authorised and recorded, structural errors are caught by machines before humans rely on them, and the failure modes that remain are visible within a defined detection window", bold: true },
  { text: ". That standard decomposes into four control planes, each addressed below: money integrity, an append-only audit trail, dual control on decisions that move money, and ingestion integrity. A fifth section covers the guardrails around LLM extraction, which is the one input channel whose output is not deterministic." },
]));

c.push(h2("Control plane 1: money integrity"));
c.push(para([
  { text: "The foundation is already correct: Decimal(14,2) columns everywhere money lives, Decimal.js accumulation for sums, and boundary conversion inside the IEEE-754 safe range. The plan extends this in three ways. First, a currency normalisation rule: the pilot scope is INR, and the discipline is one stored currency per deployment with the currency code on every monetary aggregate, so that a second currency later is a schema conversation rather than a silent mixed-denomination sum. Second, an explicit rounding policy documented in the engine: banker's rounding at two decimal places for derived totals, applied identically in every rule, because inconsistent rounding across rules is a real class of penny-level drift. Third, and most importantly, executable invariants: the tie-out checks that an accountant would perform become tests that run on every reconciliation - line items sum to their invoice total, milestone values sum to the contract value they belong to, finding impact amounts never exceed the value of the evidence they cite, and dashboard totals equal database aggregates recomputed independently of the query path." },
]));

c.push(para([
  { text: "These invariants live as a dedicated invariant test suite with production-shaped data, distinct from the unit suite: they encode the arithmetic a forensic product claims to perform, and their failure is a release blocker by definition. The existing engine suite (deterministic signatures, idempotent re-runs) is the precedent; the invariant suite is its financial counterpart." },
]));

c.push(h2("Control plane 2: the append-only audit trail"));
c.push(para([
  { text: "The audit log is immutable today by convention: the application never issues update or delete against it, but nothing enforces that at the database. Convention is not a control. The enforcement is a database-level rule: the application's PostgreSQL role loses UPDATE and DELETE on the audit table outright, so a compromised application cannot rewrite its own history; a separate operator role retains them for legally-required corrections, and its use is logged out-of-band. Optionally in a later phase, each audit row carries a hash of its predecessor, making wholesale history rewrites detectable even by the operator path. The audit log also gains a retention policy that outlives the business data it describes (aligned with the compliance chapter's retention schedule), because an audit trail that expires with the data it explains is not an audit trail." },
]));

c.push(h2("Control plane 3: dual control on money-moving decisions"));
c.push(para([
  { text: "Today a finding is reviewed by a single reviewer whose role permits it, which is sufficient for a demo and insufficient for an expense-decision pipeline. The control is separation of preparer and approver: the engine prepares findings (as drafts, already the case), and approval of any finding whose impact amount crosses a configurable threshold requires a reviewer who is not the ingestion actor who loaded the evidence and not the administrator who ran the extraction. The finding state machine already models the draft-to-reviewed transition, so the change is a guard on the transition rather than a new flow: the approver identity is compared against the recorded preparer identities, and a violation returns a 403 with a message that names the control, exactly as the existing role guards do. High-impact findings additionally require an explicit confirmation step that restates the impact amount and the evidence it rests on, so the number a human signs is the number the system recorded." },
]));

c.push(h2("Control plane 4: ingestion integrity"));
c.push(para([
  { text: "Ingestion already validates row by row, quarantines bad rows without rejecting the file, and reports what it skipped; the plan hardens this into a counting discipline: every ingestion returns accepted, rejected, and unchanged counts, and the sum must equal the rows in the file, which the existing dry-run then re-verifies as a checksum of intent before any write. Re-runs prove idempotence the same way the verification suites already do for the engine (reconcile twice, expect zero new findings), and that proof moves from a demo script into CI against production-shaped fixtures. Uploaded evidence gains immutable provenance: the file's content hash, row count, and parser version are recorded with the ingestion, so any finding can answer not only which rows support it but which exact upload produced those rows - the property that makes a disputed number arguable six months later." },
]));

c.push(h2("Guardrails on LLM extraction"));
c.push(para([
  { text: "Contract extraction is the one input whose output is generated rather than parsed, and it must be treated as untrusted input to a financial system rather than as truth. Four gates apply. Output is validated against a strict schema (milestones, rates, exclusions, change-order clauses) and any field that fails validation is dropped to a human review queue rather than guessed. Extracted values that feed money calculations (rates, milestone values) are presented in a review UI that shows the source text span they came from, so the reviewer confirms the number against the clause rather than against the model's summary - the extraction pipeline already produces this linkage, and the review step makes it load-bearing. Confidence gating means low-confidence extractions never auto-populate financial fields. And determinism is preserved where it matters: the deterministic engine, not the LLM, computes finding impact amounts, so a hallucination can surface a wrong clause quote for a human to catch but cannot invent arithmetic." },
]));

// ═══════════════ 7. BLOCKER 5: INGESTION & CONNECTORS ═══════════════
c.push(h1("Blocker 5: Evidence Ingestion and Connector Architecture"));

c.push(h2("Where ingestion stands and why it cannot stay there"));
c.push(para([
  { text: "The current ingestion path - manual upload of CSV or JSON exports with dry-run preview, lenient header matching, Indian-convention dates, per-source idempotence (tickets upsert by project and external identifier, commits deduplicate by reference, known invoices are skipped), and upload rate limits - is genuinely good demo-grade engineering, and the hardening in Blocker 4 makes it trustworthy. What it cannot do is be the operational interface for a finance team: a customer running an audit must export from Jira, export from GitHub or their git host, export invoices from their ERP, and upload three files by hand. The failure is not correctness but adoption: every manual step is a step the customer can skip, defer, or get wrong, and the freshness of the evidence decays with each one." },
]));

c.push(h2("Ingestion contracts and the connector tier"));
c.push(para([
  { text: "The architecture introduces an explicit ingestion contract per source: a versioned schema, a canonical row shape, and a validation profile, with the CSV uploader and future connectors both feeding the same contract boundary. The current per-source semantics (upsert, dedupe, skip) become the contract's merge policy, documented and versioned. On top of that boundary sit native connectors - the first three candidates being the Jira REST export API for tickets, the GitHub API for commit and pull-request activity, and the customer's invoicing system for invoice lines. For the Indian target market the third candidate means Zoho Books or Tally, and the choice is deliberately driven by the first pilot customer's actual stack rather than by market share." },
]));

c.push(para([
  { text: "Each connector authenticates with credentials scoped to the customer organisation, stored encrypted at rest (an envelope-encryption scheme with a provider-managed key), never logged, and revocable by the customer. Sync is incremental with watermarks: the connector records the last-synced cursor per source (a Jira updated-at timestamp, a GitHub commit cursor, an invoice sequence) and pulls only what changed, writing through the same ingestion contract and merge policies as manual upload, so the correctness machinery built in Blocker 4 applies unchanged. Every sync writes an audit entry recording the source, window, and row counts." },
]));

c.push(h2("Provenance end to end"));
c.push(para([
  { text: "The provenance property from Blocker 4 extends through the connector tier: a finding cites its evidence rows; an evidence row records the ingestion batch that created it; a batch records the source, the credentials identity used, the cursor window, and the content checksum. The chain answers the dispute scenario that defines the product: when a customer contests a finding, the answer is a click through to the invoice line, the commit, and the SOW clause, each with its provenance attached. That is the structural difference between an audit tool and a report generator, and it is why connector work belongs in the same architecture as the correctness programme rather than as a bolt-on integration project." },
]));

module.exports = c;
