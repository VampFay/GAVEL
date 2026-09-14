// Chapters 8-12: Blocker 6 (Ops), Blocker 7 (Confidence), Sequencing, Compliance, Conclusions
const { para, h1, h2, tableCaption, bizTable } = require("./helpers");

const c = [];

// ═══════════════ 8. BLOCKER 6: PRODUCTION OPERATIONS ═══════════════
c.push(h1("Blocker 6: Production Operations Discipline"));

c.push(h2("Secrets and configuration"));
c.push(para([
  { text: "The application already refuses to start in production with a weak JWT secret - it throws rather than falling back, and the dev fallback announces itself in every log line. The gap is narrower than it looks, but it is real: production secrets still have to live somewhere, and the plan requires that somewhere to be the hosting platform's secret store (Fly secrets, Railway variables, or AWS Secrets Manager) rather than a .env file in a deployment image. Access to the secret store is role-gated, secrets are rotated on a schedule (the JWT secret rotation pairs with the session-table revocation from Blocker 3: rotation invalidates tokens, sessions force re-login, nothing is lost), and the configuration surface that exists today - the environment schema with its typed parser and hard-fail semantics - remains the single gate through which every variable enters the process." },
]));

c.push(h2("Migrations and deployment pipeline"));
c.push(para([
  { text: "The CI pipeline today runs lint, typecheck, the unit suite, and a production build on every push, which is a solid skeleton. Production readiness adds the gates that make deploys safe rather than merely green: " },
  { text: "prisma migrate deploy", bold: true },
  { text: " runs as a gated step before the application rolls, so schema and code move together under the expand-contract discipline from Blocker 1; the end-to-end suites (login, reconciliation, ingestion idempotence) run against a production-shaped ephemeral database with seeded data, so a broken deploy fails before it reaches customers; and deploys themselves are rolling with health-check gating, with the previous image retained for one-click rollback. The standalone output build the app already produces deploys as a container; the platform runs two instances behind it for availability from day one, which also forces every piece of state out of process memory immediately rather than retroactively." },
]));

c.push(h2("Observability and failure detection"));
c.push(para([
  { text: "Structured logging exists; metrics and alerting do not, which means today a broken extraction or a wedged reconciliation is discovered by a human noticing. The plan adds the minimum observability spine that an unattended system needs: error tracking with grouping and release attribution (Sentry-class), golden-signal metrics per route (rate, errors, latency) and per job (reconciliation duration, ingestion batch sizes), uptime monitoring from outside the platform, and alerts routed to a channel someone actually reads, with severity levels that distinguish page-now (data path failing) from next-morning (degraded convenience). Structured logs gain a request identifier throughout - the audit log already stamps request identifiers, so the correlation key exists and merely needs to flow into the application log lines." },
]));

c.push(h2("Rate limiting, backups, and the restore drill"));
c.push(para([
  { text: "The login rate limiter is in-memory and single-process by design, and the design comment already names its replacement: an external store (Redis, or a serverless equivalent such as Upstash) backing the same sliding-window algorithm, with the per-IP and per-email keying preserved. The switch is mechanical, and running two instances from day one makes it mandatory rather than optional. Backups graduate with the data layer: managed PostgreSQL provides point-in-time recovery, and the retention window is set to exceed the audit-log retention policy so that a financial dispute inside the retention period can always be investigated against data. The control that turns backups from a checkbox into a resilience property is the restore drill: a documented, rehearsed procedure that restores a database from backup into a staging environment, runs the invariant suite against it, and measures how long it took - performed once before the first pilot and quarterly thereafter, with the drill log retained as evidence for the compliance chapter." },
]));

// ═══════════════ 9. BLOCKER 7: ENGINE CONFIDENCE ═══════════════
c.push(h1("Blocker 7: Engine Confidence and Decision Integrity"));

c.push(h2("An honest account of the current confidence model"));
c.push(para([
  { text: "GAVEL's confidence model is transparent and hand-tuned: evidence types carry fixed weights (contract clause 0.30, delivery record 0.25, billing record 0.20, change order 0.20, supporting 0.10, contradicting evidence minus 0.20), a finding's composite is the clamped sum, and the buckets are high at 0.70, medium at 0.45, below that low. The weak-link cap - fuzzy delivery links contribute at most 0.10 - exists precisely because a fuzzy match must never be able to lift a finding into the same bucket as an explicit milestone-identifier match. This is a defensible v1: it is explainable, auditable, and deliberately not a learned model, because there are no labelled outcomes to learn from yet. The blocker is not that the weights are hand-tuned; it is that no mechanism exists to discover when they are wrong." },
]));

c.push(h2("The calibration loop"));
c.push(para([
  { text: "Reviewer decisions - approvals, dismissals, and escalations - are the labelled outcomes the model needs, and they are already recorded in the finding state machine with actor and timestamp. The calibration loop closes that circle: per rule and per evidence-type composition, the system computes the observed approval rate of findings at each confidence bucket, and a quarterly review compares observed precision against the bucket's promise. A rule whose high-confidence findings are dismissed half the time is a rule whose weights lie, and the review either retunes the weights or retires the rule, with the change recorded as a new rule version. The invariants that protect this loop: weights only change between versions, never mid-run; every finding stores the rule version and evidence composition that produced it; and the confidence breakdown (already persisted per finding) remains the explanation surface shown to reviewers, so a retuned model never becomes an unexplained one." },
]));

c.push(h2("Entity resolution and reproducibility"));
c.push(para([
  { text: "The weakest link in evidence joining is fuzzy entity resolution - a two-token description overlap between a commit and a milestone - and the plan's posture is to prefer determinism wherever the source systems allow it: explicit identifiers (Jira keys in commit messages, milestone references in branch names) outrank text similarity, link strength is surfaced to the reviewer rather than hidden, and a weak link is visually distinguishable from a strong one in the review UI so the human knows which joins they are vouching for. Reproducibility completes the integrity picture: given the same evidence set and rule version, the engine is already deterministic (the signature-based idempotence proves it); the plan pins that property into the audit story by stamping findings with the rule version and a hash of their input evidence, so a finding can be re-derived and shown to be unchanged - the reconciliation equivalent of showing your work." },
]));

// ═══════════════ 10. SEQUENCING ═══════════════
c.push(h1("Implementation Sequencing: Phases P0 to P3"));

c.push(h2("Dependency ordering without calendar commitments"));
c.push(para([
  { text: "The phases below are ordered by dependency, not by date: a phase is done when its exit gate is demonstrated, and the gate conditions are objective enough that no judgement calls are required to declare them met. Dependencies flow in one direction with limited parallelism inside each phase: the data layer and provisioning must exist before correctness controls can be enforced against production-shaped data; isolation enforcement must be proven before a second organisation shares any infrastructure; connectors and calibration matter only once the system they feed is trustworthy. Effort estimates are deliberately omitted - the plan states what must be true, and the team converts that into schedule separately, because a schedule written now would be fiction dressed as a commitment." },
]));

c.push(tableCaption("Table 2: Phase gates and entry/exit criteria"));
c.push(bizTable([
  ["Phase", "Theme", "Entry criteria", "Exit gate (demonstrated)"],
  ["P0", "Foundation: data layer, secrets, provisioning", "Plan approved; provider account created", "One pilot organisation provisioned on managed PostgreSQL via migrate deploy; secrets in platform store; admin invited via token and self-onboarded; all E2E suites green against the migrated stack"],
  ["P1", "Financial-grade correctness", "P0 exit", "Append-only audit enforced at DB role level; dual-control guard active on high-impact findings; invariant suite (line-item and milestone tie-outs) passing in CI; restore drill completed with measured recovery time"],
  ["P2", "Isolation and hardening", "P0 exit (parallel with P1 where teams allow)", "Tenant scoping extension live with empty escape-hatch register and route-surface test; sessions revocable, MFA-TOTP for admins; rate limiter externalised; metrics, alerts, and error tracking live; second pilot organisation onboarded safely"],
  ["P3", "Scale and connectors", "P1 and P2 exit", "First native connector in production with incremental sync and credential vault; calibration report v1 published (observed precision per bucket); SOC 2 Type I readiness assessment passed with the control mapping in this plan"],
], [8, 22, 26, 44]));

c.push(h2("What sequences strictly and what parallelises"));
c.push(para([
  { text: "Three dependencies are strict: PostgreSQL precedes everything (migrations, invariant tests, and the dual-instance deployment all assume it); provisioning precedes dual control (separation of preparer and approver requires more than one real human with distinct accounts); and tenant columns precede tenant-scoping enforcement (P2 cannot enforce what P0 did not write). Everything else has slack: the invariant suite can be written against the current SQLite stack and simply re-pointed; observability can land incrementally during P1; the calibration loop's data capture (recording reviewer outcomes with rule versions) begins the day P0 exits, even though the first calibration report is a P3 artifact. The sequencing principle throughout: trust-building controls (P1) land before scale-building work (P3), because a pilot customer who catches one silent error costs more than a quarter of roadmap." },
]));

// ═══════════════ 11. COMPLIANCE ═══════════════
c.push(h1("Compliance Readiness: DPDP, GDPR and SOC 2 Foundations"));

c.push(h2("What GAVEL actually processes"));
c.push(para([
  { text: "Compliance planning starts from an inventory of what the system actually touches, mapped onto GAVEL's real data model rather than a generic checklist. The inventory below drives every subsequent obligation: notably, GAVEL processes no special-category personal data (no health, biometric, or children's data), which simplifies both DPDP and GDPR posture, but it does process financial records and business contact data inside a lawful-purpose B2B relationship, and it sends customer contract text to a third-party large-language-model provider, which is the single most compliance-significant data flow in the product." },
]));

c.push(tableCaption("Table 3: Data inventory mapped to GAVEL data flows"));
c.push(bizTable([
  ["Data category", "Where it lives (schema)", "Sensitivity", "Notable flows"],
  ["Business contact data", "User (name, email), Client contact fields", "Personal data (DPDP/GDPR)", "Invitation emails, access review reports"],
  ["Contract and SOW documents", "Contract, Milestone, Exclusion, ChangeOrder", "Confidential business data", "Sent to third-party LLM provider during extraction"],
  ["Billing and invoice records", "Invoice, InvoiceLine, Payment, money columns", "Financial records", "Ingested from customer ERP; cited by findings"],
  ["Source-code activity metadata", "CodeActivity, Ticket (ids, timestamps, refs)", "Confidential metadata, not source text", "Ingested from GitHub/Jira exports"],
  ["Audit trail", "AuditLog (actor, action, entity, request id)", "Security-relevant, integrity-critical", "Retention outlives business data"],
], [22, 30, 22, 26]));

c.push(h2("DPDP Act 2023 (India) - the primary regime"));
c.push(para([
  { text: "GAVEL's first customers are Indian dev/IT services firms, making India's Digital Personal Data Protection Act the governing regime. The lawful-basis analysis is favourable: processing is necessary for a contract the customer (the Data Principal's employer) has with GAVEL and for its performance - reconciling the customer's own billing records is the service. Notice obligations are discharged at onboarding: the terms state what is processed, for what purpose, and for how long. Purpose limitation and minimisation map to product discipline: ingestion pulls only ticket metadata, commit metadata, and invoice lines, not repository contents, and the plan's retention schedule (below) enforces storage limitation. The obligations that need real machinery rather than policy text: a grievance redressal channel with a named response contact (a Data Protection Officer designation in DPDP terms), breach notification capability (detect via the observability spine, notify the Data Protection Board and affected principals within the statutory window - the incident runbook from Blocker 6 is the operational half of this), and erasure handling, which is where DPDP intersects the audit trail and is treated below." },
]));

c.push(h2("GDPR - if and when EU customers arrive"));
c.push(para([
  { text: "The GDPR posture inherits DPDP work and adds four items. A data processing agreement chain: GAVEL-as-processor for customer data, with sub-processor DPAs covering the hosting provider and the LLM provider - the LLM DPA must include a no-training-on-customer-content clause, which reputable providers offer contractually today and which this plan treats as non-negotiable. Data subject rights follow the same machinery as DPDP erasure. International transfers: the LLM API call sends contract text across borders, resolved either by provider EU/India data residency options or by standard contractual clauses; the redaction option (strip counterparty names and identifiers before extraction, re-hydrate after) is the fallback that keeps the product deployable even where a customer's policy forbids the transfer outright. Records of processing and a data protection impact assessment for the LLM flow are documents, and the control mapping below is their starting draft." },
]));

c.push(h2("Erasure versus the audit trail - resolved explicitly"));
c.push(para([
  { text: "The one genuine tension in the compliance design: a departing employee's personal data is erasable on request, but the audit log records their actions as the integrity backbone of a financial system, and an audit trail with holes in it is worthless. The resolution is anonymisation rather than deletion: on erasure, the user row is deleted (name, email gone), and audit entries are rewritten to replace the actor identity with a pseudonymous marker (a stable random identifier with no lookup path back to the person), preserving the integrity property (the same actor did these actions) while removing the personal data. The rewrite is performed by the operator path that retains audit-write permission, is itself logged out-of-band, and is documented in the retention schedule. This is a standard reconciliation-system pattern, and stating it in the plan pre-empts the first security reviewer who asks." },
]));

c.push(h2("SOC 2 foundations - control mapping"));
c.push(para([
  { text: "SOC 2 Type I becomes realistic at P3 exit, and the mapping below is deliberately honest about what exists versus what the plan builds, because the fastest way to fail an assessment is to claim controls that are not demonstrable. The trust-service criteria map cleanly onto work already sequenced in this plan, which is the argument for treating compliance as a byproduct of the engineering phases rather than a separate programme." },
]));

c.push(tableCaption("Table 4: SOC 2 Trust Services criteria mapped to GAVEL"));
c.push(bizTable([
  ["Criterion", "What it asks", "GAVEL today", "Delivered by"],
  ["CC6 - Logical access", "Unique accounts, least privilege, MFA where warranted, credential management", "RBAC, scrypt, session cookies, rate limiting", "P0-P2: provisioning lifecycle, session revocation, admin TOTP"],
  ["CC7 - Monitoring", "Detect and respond to anomalies and failures", "Structured logs, audit trail, request ids", "P2: error tracking, metrics, alerting, incident runbook"],
  ["CC8 - Change management", "Authorised, tested, reviewable changes", "CI gates (lint, typecheck, tests, build), PR review", "P0-P1: migrate deploy in pipeline, E2E suites in CI, rollback capability"],
  ["CC9 - Confidentiality", "Protect confidential information, define retention", "SameSite cookies, no-CORS edge policy, Decimal integrity", "P1-P2: audit DB-role enforcement, backups with retention, LLM DPA and redaction, retention schedule"],
], [14, 26, 28, 32]));

// ═══════════════ 12. CONCLUSIONS ═══════════════
c.push(h1("Conclusions and Immediate Next Actions"));

c.push(para([
  { text: "The deployment question resolves into a sequence rather than a verdict: GAVEL earns production readiness one gate at a time, and each gate in this plan is objectively demonstrable. The engineering foundation is stronger than the blocker list suggests - real authentication, a real audit trail, correct money types, a deterministic engine, and a test culture that already verifies against running servers - which is why the plan spends its effort on controls and operations rather than on rebuilding what exists. The zero-error bar is honoured not by promising perfection but by installing the four financial control planes (money integrity, append-only audit, dual control, ingestion integrity) that make errors detectable, attributable, and recoverable, and by keeping human review load-bearing on exactly the decisions that move money." },
]));

c.push(para([
  { text: "Three decisions unlock P0 and belong to the founder rather than the codebase: choose the managed PostgreSQL provider (the four criteria in Blocker 1 make it a one-hour decision); name the first pilot customer's technology stack, because it selects the first connector in P3 and shapes the compliance scope; and confirm the compliance scope (India-only DPDP posture versus GDPR-ready from day one), which sets the DPA work that parallels the engineering phases. With those answered, P0 begins with the provider account, the first migration, and the invitation email that onboards the first real administrator - the moment the product stops being a demo and starts being infrastructure someone relies on." },
]));

module.exports = c;
