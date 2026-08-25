'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAppStore } from '@/stores/app-store'
import {
  IndianRupee, CheckCircle2, Lock, Activity, Sparkles,
  ArrowRight, Building2, FileText, ShieldCheck,
} from 'lucide-react'

const TIERS = [
  {
    id: 'free',
    name: 'Free diagnostic',
    price: '₹0',
    sub: 'No credit card',
    blurb: 'Enough to create desire, nothing actionable — you cannot bill a client off a headline figure alone.',
    features: [
      { label: 'Headline number only', included: true },
      { label: 'Confidence band', included: true },
      { label: 'Finding evidence detail', included: false },
      { label: 'Exportable case file', included: false },
      { label: 'Live connectors', included: false },
    ],
    tone: 'muted' as const,
  },
  {
    id: 'audit',
    name: 'Forensic audit',
    price: '₹25k–₹1 L',
    sub: 'or 10% success fee',
    blurb: 'The artifact that\u2019s actually usable in a client conversation. Contingency lowers the trust barrier for the first sale.',
    features: [
      { label: 'Full evidence report', included: true },
      { label: 'Every finding, full anatomy', included: true },
      { label: 'Exportable case file (PDF)', included: true },
      { label: 'Client-choice: flat or 10%', included: true },
      { label: 'Live connectors', included: false },
    ],
    tone: 'primary' as const,
    highlight: 'Most chosen',
  },
  {
    id: 'monitoring',
    name: 'Monitoring',
    price: '₹15k+/mo',
    sub: 'scales with project count',
    blurb: 'Unlocks automation — connectors instead of manual upload, alerts instead of on-demand reports, trend/benchmark data.',
    features: [
      { label: 'Live connectors (GitHub, Jira)', included: true },
      { label: 'Real-time alerts', included: true },
      { label: 'Continuous reconciliation', included: true },
      { label: 'Auto-drafted change orders', included: true },
      { label: 'Cross-client benchmarking', included: true },
    ],
    tone: 'muted' as const,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    sub: 'annual contract',
    blurb: 'For shops above ~50 employees. Adds SSO, custom policy rules, dedicated support, cross-project benchmarking at scale.',
    features: [
      { label: 'Everything in Monitoring', included: true },
      { label: 'SSO (SAML, OIDC)', included: true },
      { label: 'Custom policy rules', included: true },
      { label: 'Dedicated success manager', included: true },
      { label: 'SOC2-adjacent compliance pack', included: true },
    ],
    tone: 'muted' as const,
  },
]

export function PricingView() {
  const { openIntake } = useAppStore()

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="text-center max-w-3xl mx-auto mb-10">
        <Badge variant="outline" className="text-[10px] uppercase tracking-wider mb-3">Payment wall logic</Badge>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">The free tier shows the number. The audit unlocks the evidence.</h1>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
          Pricing is INR-primary; adjust for other markets later. Contingency (10%) vs. flat fee is offered as a <strong>client choice</strong>, not a forced structure — contingency lowers the trust barrier for the first sale (they only pay if you find something), flat fee suits clients uncomfortable sharing revenue-linked terms.
        </p>
      </div>

      {/* Tiers */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {TIERS.map(t => {
          const primary = t.tone === 'primary'
          return (
            <Card
              key={t.id}
              className={`relative ${primary ? 'border-primary bg-primary/5' : 'border-border'}`}
            >
              {t.highlight && (
                <div className="absolute -top-2 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-wider font-semibold bg-primary text-primary-foreground px-2.5 py-0.5 rounded-full">
                  {t.highlight}
                </div>
              )}
              <CardContent className="p-5 h-full flex flex-col">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">{t.name}</div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-2xl font-semibold">{t.price}</span>
                  {t.sub && <span className="text-[11px] text-muted-foreground">{t.sub}</span>}
                </div>
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{t.blurb}</p>
                <ul className="mt-4 space-y-2 flex-1">
                  {t.features.map(f => (
                    <li key={f.label} className="flex items-start gap-1.5 text-xs">
                      {f.included ? (
                        <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" />
                      ) : (
                        <Lock className="h-3.5 w-3.5 mt-0.5 text-muted-foreground/50 shrink-0" />
                      )}
                      <span className={f.included ? 'text-foreground' : 'text-muted-foreground line-through'}>{f.label}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  className="mt-5 w-full"
                  variant={primary ? 'default' : 'outline'}
                  onClick={openIntake}
                >
                  {t.id === 'free' ? 'Start free diagnostic' : t.id === 'enterprise' ? 'Talk to us' : 'Get started'}
                  <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Payment-wall philosophy */}
      <Card className="mt-10">
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <PhilosophyBlock
              icon={IndianRupee}
              title="Free shows the number, never the evidence"
              body="Enough to create desire, nothing actionable — you can\u2019t bill a client off a headline figure alone, only off the full case file. The free tier is a teaser, not a working tool."
            />
            <PhilosophyBlock
              icon={FileText}
              title="Audit unlocks the case file"
              body="The artifact that\u2019s actually usable in a client conversation. Every finding, full anatomy, exportable case file. This is the artifact a real recovery hinges on."
            />
            <PhilosophyBlock
              icon={Activity}
              title="Monitoring unlocks automation"
              body="Connectors instead of manual upload. Alerts instead of on-demand reports. Trend / benchmark data. The product shifts from forensic to preventive — and from one-time to recurring revenue."
            />
          </div>
        </CardContent>
      </Card>

      {/* Contingency */}
      <Card className="mt-4 border-amber-300/40 bg-amber-50 dark:bg-amber-950/10">
        <CardContent className="p-6">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-lg bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-medium">Contingency vs. flat fee — offered as a client choice</h3>
              <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
                Contingency lowers the trust barrier for the first sale (they only pay if you find something). Flat fee suits clients uncomfortable sharing revenue-linked terms. Plausible given decades of precedent in AP recovery-audit (e.g. PRGX on the vendor-overpayment side), but unverified on the AR/services side specifically — see Assumptions §11.4.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Enterprise security teaser */}
      <Card className="mt-4">
        <CardContent className="p-6">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-medium flex items-center gap-2">
                Trust &amp; compliance — designed from day one, not retrofitted
                <Badge variant="outline" className="text-[10px]">all tiers</Badge>
              </h3>
              <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
                Read-only OAuth scopes wherever the provider allows. Tenant-scoped row-level isolation in Postgres. Encryption at rest (KMS) and in transit (TLS). Immutable audit log for every access, review, export, and finding action. No customer data used to train shared models by default. Data minimization: starts with project/financial records only; communications data (Slack/email) later, and only opt-in.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function PhilosophyBlock({
  icon: Icon, title, body,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  body: string
}) {
  return (
    <div>
      <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-3">
        <Icon className="h-4 w-4" />
      </div>
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">{body}</p>
    </div>
  )
}
