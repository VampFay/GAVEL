'use client'

import { useAppStore } from '@/stores/app-store'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  ArrowRight,
  FileText,
  GitBranch,
  ClipboardCheck,
  IndianRupee,
  CheckCircle2,
  ShieldCheck,
  Layers,
  Activity,
  AlertTriangle,
} from 'lucide-react'

export function LandingView() {
  const { setView, openIntake } = useAppStore()

  return (
    <div className="relative">
      {/* HERO */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 ledger-grid opacity-50" />
        <div className="absolute inset-0 hero-glow" />
        <div className="relative max-w-7xl mx-auto px-4 md:px-6 py-16 md:py-24 flex flex-col items-center text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground mb-6">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            Forensic delivery-to-billing reconciliation · dev/IT services only
          </div>
          <h1 className="anim-hero-rise font-semibold tracking-tight text-4xl md:text-6xl max-w-4xl leading-[1.05]">
            We found money you already <span className="text-primary ink-sweep">earned</span>.
          </h1>
          <p className="mt-5 max-w-2xl text-base md:text-lg text-muted-foreground leading-relaxed">
            GAVEL reads what was contracted in your SOWs, what was actually built in GitHub and Jira,
            and what was invoiced — then surfaces the gap as an <strong className="text-foreground">evidence-backed finding</strong> a human can approve and bill.
          </p>
          <div className="mt-7 flex flex-col sm:flex-row gap-3">
            <Button size="lg" onClick={openIntake} className="bg-primary text-primary-foreground hover:bg-primary/90">
              <FileText className="h-4 w-4 mr-1.5" />
              Run an audit
            </Button>
            <Button size="lg" variant="outline" onClick={() => setView('dashboard')}>
              See a sample case file
              <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          </div>

          {/* Headline metrics */}
          <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-4 w-full max-w-4xl">
            {[
              { label: 'Target: unbilled identified', value: '₹6.8 L', sub: 'Phase-0 target — not yet measured' },
              { label: 'Target: findings accepted', value: '78%', sub: 'Phase-0 target — not yet measured' },
              { label: 'Target: time to first finding', value: '<48 h', sub: 'Phase-0 target — not yet measured' },
              { label: 'Audit fee', value: '₹25k–₹1 L', sub: 'or 10% success fee' },
            ].map(m => (
              <div key={m.label} className="text-left">
                <div className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground">{m.value}</div>
                <div className="text-xs text-muted-foreground mt-1">{m.label}</div>
                <div className="text-[10px] text-muted-foreground/70">{m.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* THE WEDGE */}
      <section className="border-b border-border">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-16">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.16em] text-primary font-semibold mb-3">Why this wedge</p>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight leading-tight">
              Every existing player reads your billing stack. We read your <span className="text-primary">GitHub</span>.
            </h2>
            <p className="mt-4 text-base text-muted-foreground leading-relaxed">
              Professional-services firms lose an estimated 5–12% of earned revenue to unbilled work, scope creep, and missed milestones — but every existing tool reconciles billing systems only (Stripe, CRM, time-tracking). Software delivery is the one services category that leaves a hard-to-fake, timestamped, third-party-verifiable record of work performed: commits, PRs, ticket state. That data source is the entire differentiation.
            </p>
            <p className="mt-3 text-base text-muted-foreground leading-relaxed">
              Outside dev/IT services, that record doesn&apos;t exist. So the wedge collapses. We stay narrow on purpose.
            </p>
          </div>

          {/* Competitive comparison */}
          <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="border-dashed border-border bg-muted/30">
              <CardContent className="p-5">
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Existing tools</p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <span className="text-muted-foreground">•</span>
                    <span><strong>LeakShield / LeakGuard AI</strong> — reads Stripe billing data; subscription-SaaS only, no engineering awareness</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-muted-foreground">•</span>
                    <span><strong>xfactrs, Banyan AI</strong> — enterprise lead-to-cash leakage, ₹40 L+/yr; inaccessible to SMB agencies</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-muted-foreground">•</span>
                    <span><strong>Certinia / BigTime / Deltek</strong> — replace your tools with an all-in-one PSA suite; we integrate, don&apos;t replace</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-muted-foreground">•</span>
                    <span><strong>Kantata + Provus</strong> — forward-looking quoting accuracy, not forensic recovery of completed work</span>
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card className="border-primary bg-primary/5">
              <CardContent className="p-5">
                <p className="text-xs uppercase tracking-wider text-primary font-semibold mb-3">GAVEL</p>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>Reads GitHub / GitLab commits, PRs, merges — actual engineering evidence</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>Reconciles against Jira / Linear ticket state, not internal time-tracking</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>Compares both against the SOW line items and exclusions — line by line</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>Every finding carries: contract clause + delivery evidence + billing state + assessment + recommended action</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <span>The product proposes, a human asserts — nothing is auto-billed.</span>
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>

          <div className="mt-6 p-4 rounded-md border border-border bg-card text-sm italic text-muted-foreground">
            &ldquo;Unlike [X], we don&apos;t touch your billing stack or ask you to migrate anything — we read the GitHub and Jira you already have, and tell you what it says you&apos;re owed.&rdquo;
          </div>
        </div>
      </section>

      {/* THE FLOW */}
      <section className="border-b border-border bg-muted/20">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-16">
          <div className="max-w-2xl mb-10">
            <p className="text-xs uppercase tracking-[0.16em] text-primary font-semibold mb-3">How it works</p>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">Reconstruct the delivery-to-billing chain. Surface gaps as evidence, not opinions.</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              { icon: FileText, title: '1 · Contracts / SOW', desc: 'LLM-assisted extraction of scope items, rate cards, milestones, exclusions, change-order policy. Validated against deterministic rules — dates parse, amounts parse.' },
              { icon: Layers, title: '2 · Normalize & resolve', desc: 'Jira / Linear tickets, GitHub / GitLab PRs, commits, merges — entity-resolved against contract line items by exact reference and deterministic keyword overlap (embedding-based matching lands with the pgvector migration).' },
              { icon: AlertTriangle, title: '3 · Forensic engine', desc: 'Deterministic rules catch missed milestones, unbilled overages, scope-creep language. LLM judgment reserved for ambiguous calls — always routed to human review.' },
              { icon: ClipboardCheck, title: '4 · Human review → case file', desc: 'Decomposed confidence scoring. Approve, dismiss, escalate. Approved findings become the evidence-backed case file you bring to your client.' },
            ].map(s => {
              const Icon = s.icon
              return (
                <Card key={s.title} className="bg-card border-border">
                  <CardContent className="p-5 h-full flex flex-col">
                    <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4">
                      <Icon className="h-4 w-4" />
                    </div>
                    <h3 className="font-medium text-sm">{s.title}</h3>
                    <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{s.desc}</p>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-4">
            <FlowItem icon={GitBranch} title="Read-only connectors (Phase 2)" body="GitHub App, Atlassian, Linear, QuickBooks, Xero — least-privilege OAuth, independently revocable per provider, read-only scopes. Design goal; connectors ship in Phase 2 — today contracts are pasted and delivery records are ingested directly." />
            <FlowItem icon={ShieldCheck} title="Tenant isolation (planned)" body="Today: role-based access control and an immutable audit log on every action. Planned with the Postgres migration: row-level tenant isolation and encryption at rest (KMS)." />
            <FlowItem icon={Activity} title="Continuous monitoring (Phase 3)" body="Always-on reconciliation of active projects. Statistical drift detection on delivery-to-billing ratio. Real-time alerts. Auto-drafted change orders — human-approved, never auto-sent." />
          </div>
        </div>
      </section>

      {/* PRICING TEASER */}
      <section className="border-b border-border">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-16 flex flex-col md:flex-row items-start gap-10">
          <div className="md:max-w-md">
            <p className="text-xs uppercase tracking-[0.16em] text-primary font-semibold mb-3">Payment wall</p>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">The free tier shows the number. The audit unlocks the evidence.</h2>
            <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
              Enough to create desire, nothing actionable — you can&apos;t bill a client off a headline figure alone. The audit unlocks the case file you actually bring to the client conversation.
            </p>
            <Button variant="outline" className="mt-5" onClick={() => setView('pricing')}>
              See all tiers
              <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          </div>
          <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3 w-full">
            <PriceTile
              tier="Free diagnostic"
              price="₹0"
              includes={['Headline number only', 'Confidence band', 'No evidence detail']}
              tone="muted"
            />
            <PriceTile
              tier="Forensic audit"
              price="₹25k–₹1 L"
              sub="or 10% success fee"
              includes={['Full evidence report', 'Finding anatomy', 'Exportable case file']}
              tone="primary"
              highlight="Most chosen"
            />
            <PriceTile
              tier="Monitoring"
              price="₹15k+/mo"
              includes={['Live connectors', 'Real-time alerts', 'Continuous reconciliation']}
              tone="muted"
            />
          </div>
        </div>
      </section>

      {/* KILL CRITERION — radical honesty */}
      <section className="border-b border-border bg-muted/20">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-16">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2">
              <p className="text-xs uppercase tracking-[0.16em] text-primary font-semibold mb-3">Built to be falsifiable</p>
              <h2 className="text-2xl md:text-3xl font-semibold tracking-tight leading-tight">
                We run Phase 0 on three real projects. If fewer than two surface a material, evidence-backed finding the client agrees is real — the premise is false.
              </h2>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                Not the pitch, not the pricing, the <em>premise</em>. Stop and reassess rather than iterate on messaging. Every assumption in the plan is named, and the kill criteria are stated before any tool is built.
              </p>
            </div>
            <div className="flex flex-col justify-center gap-3">
              <Button size="lg" onClick={openIntake} className="bg-primary text-primary-foreground hover:bg-primary/90">
                <FileText className="h-4 w-4 mr-1.5" />
                Run an audit
              </Button>
              <Button size="lg" variant="outline" onClick={() => setView('review_queue')}>
                See the review queue
                <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function FlowItem({ icon: Icon, title, body }: { icon: React.ComponentType<{ className?: string }>; title: string; body: string }) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-lg border border-border bg-card">
      <div className="h-8 w-8 shrink-0 rounded-md bg-primary/10 text-primary flex items-center justify-center">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{body}</p>
      </div>
    </div>
  )
}

function PriceTile({
  tier, price, sub, includes, tone, highlight,
}: {
  tier: string
  price: string
  sub?: string
  includes: string[]
  tone: 'muted' | 'primary'
  highlight?: string
}) {
  const primary = tone === 'primary'
  return (
    <div className={`relative rounded-lg border p-5 ${primary ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}>
      {highlight && (
        <div className="absolute -top-2 right-3 text-[10px] uppercase tracking-wider font-semibold bg-primary text-primary-foreground px-2 py-0.5 rounded-full">
          {highlight}
        </div>
      )}
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{tier}</div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-2xl font-semibold">{price}</span>
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </div>
      <ul className="mt-3 space-y-1.5">
        {includes.map(i => (
          <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <IndianRupee className="h-3 w-3 mt-1 text-primary shrink-0" />
            {i}
          </li>
        ))}
      </ul>
    </div>
  )
}
