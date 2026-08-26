'use client'

import { useEffect, useState } from 'react'
import { useAppStore } from '@/stores/app-store'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'
import {
  Upload, FileText, GitBranch, ClipboardList, Loader2,
  CheckCircle2, ArrowRight, ArrowLeft, Sparkles, X,
  IndianRupee, Building2, AlertCircle,
} from 'lucide-react'
import { formatINR, formatDate } from '@/lib/shipledger'

interface Client {
  id: string
  name: string
  industry: string | null
  sizeBand: string | null
}

interface ExtractedContract {
  title: string | null
  effectiveDate: string | null
  endDate: string | null
  currency: string | null
  totalValue: number | null
  lineItems: Array<{ description: string; rate: number | null; rateUnit: string | null; quantity: number | null; milestone: string | null }>
  milestones: Array<{ id: string; description: string; dueDate: string; value: number | null; currency: string }>
  exclusions: Array<{ clause: string; description: string }>
  changeOrderPolicy: string | null
  rawNotes: string[]
}

const SAMPLE_SOW = `STATEMENT OF WORK — Master Services Agreement
Client: Northwind Logistics
Project: Warehouse Management System (WMS) Modernization
Effective: 01 August 2025  |  End: 31 December 2025
Currency: INR

1. SCOPE
 1.1 Inventory tracking module (barcode + RFID)
 1.2 Pick-path optimization engine
 1.3 Carrier integration (DTDC, BlueDart, Delhivery)
 1.4 Reporting dashboard with exportable PDF/Excel

2. RATE CARD
  Senior engineer: INR 4,200 / hour
  Frontend engineer: INR 2,600 / hour
  QA engineer: INR 2,000 / hour

3. MILESTONES
  M1 — Inventory tracking complete: 31 August 2025 → INR 5,00,000
  M2 — Pick-path engine: 30 September 2025 → INR 4,50,000
  M3 — Carrier integration: 31 October 2025 → INR 3,80,000
  M4 — Reporting + UAT: 15 December 2025 → INR 4,20,000

4. CHANGE ORDERS
  Any scope addition requires a signed change order before work commences.

5. EXCLUSIONS
  5.1 Hardware procurement is NOT in scope.
  5.2 Warehouse-floor networking is billed separately.`

type Step = 'client' | 'sow' | 'extracting' | 'review' | 'delivery' | 'engine' | 'done'

export function IntakeModal() {
  const { intakeOpen, closeIntake, setView, openAudit } = useAppStore()
  const [step, setStep] = useState<Step>('client')
  const [clients, setClients] = useState<Client[]>([])
  const [selectedClientId, setSelectedClientId] = useState<string>('')
  const [activeClientId, setActiveClientId] = useState<string>('')
  const [newClientName, setNewClientName] = useState('')
  const [newClientIndustry, setNewClientIndustry] = useState('')
  const [sowText, setSowText] = useState('')
  const [extracted, setExtracted] = useState<ExtractedContract | null>(null)
  const [contractId, setContractId] = useState<string | null>(null)
  const [extractErr, setExtractErr] = useState<string | null>(null)

  // Reset on open
  useEffect(() => {
    if (intakeOpen) {
      setStep('client')
      setExtracted(null)
      setContractId(null)
      setExtractErr(null)
      setSowText('')
      setNewClientName('')
      setNewClientIndustry('')
      setSelectedClientId('')
      setActiveClientId('')
      // Load client list
      fetch('/api/clients').then(r => r.json()).then(d => setClients(d.clients ?? [])).catch(() => {})
    }
  }, [intakeOpen])

  const startExtraction = async () => {
    if (sowText.trim().length < 30) {
      toast.error('SOW text too short', { description: 'Paste at least a few sentences.' })
      return
    }
    // Resolve the clientId: use selected existing, else create new
    let clientId = selectedClientId
    if (!clientId) {
      const created = await createClient()
      if (!created) return
      clientId = created
    }
    setActiveClientId(clientId)

    setStep('extracting')
    setExtractErr(null)
    try {
      const res = await fetch('/api/extract-contract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText: sowText, clientId, persist: true }),
      })
      const d = await res.json()
      if (d.ok) {
        setExtracted(d.extracted)
        setContractId(d.contractId)
        setStep('review')
        toast.success('Contract extracted', {
          description: `${d.extracted.lineItems.length} line items · ${d.extracted.milestones.length} milestones · ${d.extracted.exclusions.length} exclusions`,
        })
      } else {
        setExtractErr(d.error ?? 'Extraction failed')
        setStep('sow')
        toast.error('Extraction failed', { description: d.error })
      }
    } catch (e) {
      setExtractErr(e instanceof Error ? e.message : 'unknown')
      setStep('sow')
      toast.error('Extraction failed', { description: e instanceof Error ? e.message : 'unknown' })
    }
  }

  const createClient = async (): Promise<string | null> => {
    if (!newClientName.trim()) {
      toast.error('Client name required', { description: 'Select an existing client or enter a new one.' })
      return null
    }
    const res = await fetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newClientName, industry: newClientIndustry || undefined, sizeBand: '10-50' }),
    })
    const d = await res.json()
    if (d.ok) return d.client.id
    toast.error('Failed to create client', { description: d.error })
    return null
  }

  return (
    <Dialog open={intakeOpen} onOpenChange={(o) => { if (!o) closeIntake() }}>
      <DialogContent className="max-w-3xl max-h-[90vh] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b border-border bg-muted/30">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-primary" />
                New forensic audit
              </DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                Multi-step intake: client → SOW → LLM extraction → review → delivery → forensic engine
              </DialogDescription>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={closeIntake}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        {/* Stepper */}
        <Stepper step={step} />

        <ScrollArea className="max-h-[55vh]">
          <div className="p-6">
            {step === 'client' && (
              <ClientStep
                clients={clients}
                selectedClientId={selectedClientId}
                setSelectedClientId={setSelectedClientId}
                newClientName={newClientName}
                setNewClientName={setNewClientName}
                newClientIndustry={newClientIndustry}
                setNewClientIndustry={setNewClientIndustry}
                onNext={() => setStep('sow')}
              />
            )}

            {step === 'sow' && (
              <SowStep
                sowText={sowText}
                setSowText={setSowText}
                onLoadSample={() => setSowText(SAMPLE_SOW)}
                onBack={() => setStep('client')}
                onNext={startExtraction}
              />
            )}

            {step === 'extracting' && (
              <div className="py-16 flex flex-col items-center text-center">
                <Loader2 className="h-8 w-8 text-primary animate-spin" />
                <h3 className="mt-4 text-sm font-medium">Extracting contract structure</h3>
                <p className="mt-1 text-xs text-muted-foreground max-w-md">
                  Calling the LLM with tool-use against a fixed JSON schema. Validating against deterministic rules
                  (dates parse, amounts parse, required fields present). Never trusting extraction output directly into a finding.
                </p>
                <div className="mt-6 grid grid-cols-3 gap-2 text-[10px] text-muted-foreground">
                  <div className="rounded border border-border p-2"><FileText className="h-3 w-3 mx-auto mb-1 text-primary" /> scope items</div>
                  <div className="rounded border border-border p-2"><IndianRupee className="h-3 w-3 mx-auto mb-1 text-primary" /> rate card</div>
                  <div className="rounded border border-border p-2"><ClipboardList className="h-3 w-3 mx-auto mb-1 text-primary" /> milestones</div>
                </div>
              </div>
            )}

            {step === 'review' && extracted && (
              <ReviewStep
                extracted={extracted}
                onBack={() => setStep('sow')}
                onNext={() => setStep('delivery')}
              />
            )}

            {step === 'delivery' && (
              <DeliveryStep
                onBack={() => setStep('review')}
                onNext={() => setStep('engine')}
              />
            )}

            {step === 'engine' && (
              <EngineStep
                contractId={contractId}
                onBack={() => setStep('delivery')}
                onComplete={() => setStep('done')}
              />
            )}

            {step === 'done' && contractId && (
              <div className="py-10 flex flex-col items-center text-center">
                <div className="h-12 w-12 rounded-full bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <h3 className="mt-4 font-medium">Audit ready for review</h3>
                <p className="mt-1 text-xs text-muted-foreground max-w-md">
                  The forensic engine has surfaced candidate findings. Open the case file to review and approve.
                </p>
                <div className="mt-5 flex gap-2">
                  <Button variant="outline" onClick={() => { closeIntake(); setView('review_queue') }}>
                    Open review queue
                  </Button>
                  <Button
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                    onClick={() => {
                      const targetId = activeClientId || selectedClientId
                      closeIntake()
                      if (targetId) {
                        openAudit(targetId)
                      } else {
                        setView('audits')
                      }
                    }}
                  >
                    Open audit case file
                    <ArrowRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

function Stepper({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: 'client', label: 'Client' },
    { id: 'sow', label: 'SOW' },
    { id: 'extracting', label: 'Extract' },
    { id: 'review', label: 'Review' },
    { id: 'delivery', label: 'Delivery' },
    { id: 'engine', label: 'Engine' },
    { id: 'done', label: 'Done' },
  ]
  const idx = steps.findIndex(s => s.id === step)

  return (
    <div className="px-6 py-3 border-b border-border bg-muted/20">
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin">
        {steps.map((s, i) => {
          const done = i < idx
          const active = i === idx
          return (
            <div key={s.id} className="flex items-center gap-1.5 shrink-0">
              <div
                className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-semibold ${
                  done
                    ? 'bg-primary text-primary-foreground'
                    : active
                      ? 'bg-primary text-primary-foreground ring-2 ring-primary/30'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                {done ? <CheckCircle2 className="h-3 w-3" /> : i + 1}
              </div>
              <span className={`text-[10px] uppercase tracking-wider ${active ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{s.label}</span>
              {i < steps.length - 1 && <ArrowRight className="h-2.5 w-2.5 text-muted-foreground/40 mx-0.5" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ClientStep({
  clients, selectedClientId, setSelectedClientId,
  newClientName, setNewClientName,
  newClientIndustry, setNewClientIndustry,
  onNext,
}: {
  clients: Client[]
  selectedClientId: string
  setSelectedClientId: (s: string) => void
  newClientName: string
  setNewClientName: (s: string) => void
  newClientIndustry: string
  setNewClientIndustry: (s: string) => void
  onNext: () => void
}) {
  const useExisting = !!selectedClientId
  return (
    <div>
      <h3 className="text-sm font-medium">1. Choose the audit client</h3>
      <p className="text-xs text-muted-foreground mt-1">
        The client whose SOW you&apos;re auditing. Select an existing one, or create a new client on the fly.
      </p>

      <Separator className="my-4" />

      <div className="mb-3 text-[10px] uppercase tracking-wider text-muted-foreground">Existing clients</div>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {clients.length === 0 && <p className="text-xs text-muted-foreground">No existing clients.</p>}
        {clients.map(c => (
          <button
            key={c.id}
            onClick={() => { setSelectedClientId(c.id); setNewClientName('') }}
            className={`text-left p-3 rounded border transition-colors ${
              selectedClientId === c.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
            }`}
          >
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                <Building2 className="h-3 w-3" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{c.name}</div>
                <div className="text-[10px] text-muted-foreground">{c.industry ?? '—'}</div>
              </div>
            </div>
          </button>
        ))}
      </div>

      <Separator className="my-4" />

      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Or create a new client</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label htmlFor="cn" className="text-xs">Client name</Label>
          <Input
            id="cn"
            value={newClientName}
            onChange={(e) => { setNewClientName(e.target.value); setSelectedClientId('') }}
            placeholder="e.g. Aetherworks Technologies"
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="ci" className="text-xs">Industry / segment</Label>
          <Input
            id="ci"
            value={newClientIndustry}
            onChange={(e) => setNewClientIndustry(e.target.value)}
            placeholder="e.g. Custom software development"
            className="mt-1"
          />
        </div>
      </div>

      <div className="mt-5 flex justify-end">
        <Button
          onClick={onNext}
          disabled={!useExisting && !newClientName.trim()}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          Next: paste SOW
          <ArrowRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      </div>
    </div>
  )
}

function SowStep({
  sowText, setSowText, onLoadSample, onBack, onNext,
}: {
  sowText: string
  setSowText: (s: string) => void
  onLoadSample: () => void
  onBack: () => void
  onNext: () => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">2. Paste the SOW / contract text</h3>
          <p className="text-xs text-muted-foreground mt-1">
            The LLM will extract scope items, rate card, milestones, and exclusions into a strict JSON schema.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onLoadSample}>
          <FileText className="h-3.5 w-3.5 mr-1" />
          Load sample SOW
        </Button>
      </div>

      <Textarea
        value={sowText}
        onChange={(e) => setSowText(e.target.value)}
        placeholder="Paste the full SOW text here — section headings, scope items, rate card, milestones, change-order policy, exclusions…"
        rows={14}
        className="mt-4 font-mono text-xs"
      />

      <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{sowText.length} chars · {sowText.split(/\s+/).filter(Boolean).length} words</span>
        <span>Min 30 chars required</span>
      </div>

      <div className="mt-5 flex justify-between">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1" />
          Back
        </Button>
        <Button
          onClick={onNext}
          disabled={sowText.trim().length < 30}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Sparkles className="h-3.5 w-3.5 mr-1" />
          Extract with LLM
        </Button>
      </div>
    </div>
  )
}

function ReviewStep({
  extracted, onBack, onNext,
}: {
  extracted: ExtractedContract
  onBack: () => void
  onNext: () => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" /> 3. Review extraction
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            LLM output, validated against deterministic rules. The product proposes, a human asserts before any finding is finalized.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(JSON.stringify(extracted, null, 2)).then(() => toast.success('JSON copied'))}>
          Copy JSON
        </Button>
      </div>

      {/* Summary tiles */}
      <div className="mt-4 grid grid-cols-4 gap-2">
        <Tile label="Line items" value={String(extracted.lineItems.length)} />
        <Tile label="Milestones" value={String(extracted.milestones.length)} />
        <Tile label="Exclusions" value={String(extracted.exclusions.length)} />
        <Tile label="Total value" value={formatINR(extracted.totalValue)} />
      </div>

      {/* Milestones */}
      <div className="mt-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Milestones</div>
        <div className="space-y-1.5">
          {extracted.milestones.map(m => (
            <div key={m.id} className="flex items-center justify-between p-2 rounded border border-border text-xs">
              <div className="flex items-center gap-2">
                <code className="text-[10px] px-1 py-0.5 rounded bg-muted">{m.id}</code>
                <span>{m.description}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground">{formatDate(m.dueDate)}</span>
                <span className="font-medium text-primary">{formatINR(m.value)}</span>
              </div>
            </div>
          ))}
          {extracted.milestones.length === 0 && <p className="text-xs text-muted-foreground">No milestones parsed.</p>}
        </div>
      </div>

      {/* Exclusions */}
      {extracted.exclusions.length > 0 && (
        <div className="mt-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Exclusions</div>
          <div className="space-y-1">
            {extracted.exclusions.map(e => (
              <div key={e.clause} className="text-xs p-2 rounded border border-border">
                <code className="text-[10px] px-1 py-0.5 rounded bg-muted">§{e.clause}</code>
                <span className="ml-1.5">{e.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Line items */}
      {extracted.lineItems.length > 0 && (
        <div className="mt-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Line items / scope</div>
          <div className="space-y-1 max-h-40 overflow-y-auto scrollbar-thin">
            {extracted.lineItems.map((li, i) => (
              <div key={i} className="flex items-start gap-2 p-2 rounded border border-border text-xs">
                <Badge variant="outline" className="text-[9px] shrink-0">{li.milestone ?? '—'}</Badge>
                <span className="flex-1">{li.description}</span>
                <span className="text-muted-foreground text-[10px] shrink-0">
                  {li.rate != null ? formatINR(li.rate) : '—'}/{li.rateUnit ?? '—'}
                  {li.quantity != null && ` × ${li.quantity}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {extracted.changeOrderPolicy && (
        <div className="mt-4 p-3 rounded border border-amber-300/40 bg-amber-50 dark:bg-amber-950/10">
          <div className="text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-300 mb-1">Change-order policy</div>
          <p className="text-xs">{extracted.changeOrderPolicy}</p>
        </div>
      )}

      <div className="mt-5 flex justify-between">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1" />
          Back: edit SOW
        </Button>
        <Button onClick={onNext} className="bg-primary text-primary-foreground hover:bg-primary/90">
          Approve extraction
          <ArrowRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      </div>
    </div>
  )
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded border border-border bg-muted/30 text-center">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  )
}

function DeliveryStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <div>
      <h3 className="text-sm font-medium">4. Attach delivery records</h3>
      <p className="text-xs text-muted-foreground mt-1">
        In production this is where live OAuth connectors pull from GitHub, Jira, Linear. For this demo we&apos;ll proceed with the seeded delivery records (already linked to the demo client) so you can see the full forensic flow.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <DropZone icon={GitBranch} title="GitHub / GitLab export" sub="commits, PRs, merges, deploys" />
        <DropZone icon={ClipboardList} title="Jira / Linear export" sub="tickets, epics, status, assignees" />
        <DropZone icon={IndianRupee} title="Invoices / accounting" sub="QuickBooks, Xero, CSV" />
        <DropZone icon={FileText} title="Change orders" sub="signed COs for scope additions" />
      </div>

      <div className="mt-4 p-3 rounded border border-dashed border-border bg-muted/30 text-xs text-muted-foreground">
        <strong>Demo note:</strong> the live connectors (Phase 2 of the plan) require per-provider OAuth Apps to be configured
        per tenant. For this sandbox we use the seeded delivery records for <code className="text-[10px]">Aetherworks / Veridian Patient Portal</code> so the forensic engine has real evidence to reconcile against.
      </div>

      <div className="mt-5 flex justify-between">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1" />
          Back
        </Button>
        <Button onClick={onNext} className="bg-primary text-primary-foreground hover:bg-primary/90">
          Run forensic engine
          <ArrowRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      </div>
    </div>
  )
}

function DropZone({ icon: Icon, title, sub }: { icon: React.ComponentType<{ className?: string }>; title: string; sub: string }) {
  return (
    <div className="border-2 border-dashed border-border rounded-lg p-5 text-center hover:border-primary/40 transition-colors cursor-pointer">
      <div className="h-9 w-9 mx-auto rounded-md bg-primary/10 text-primary flex items-center justify-center mb-2">
        <Icon className="h-4 w-4" />
      </div>
      <div className="text-xs font-medium">{title}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>
      <Button variant="ghost" size="sm" className="mt-2 h-6 text-[10px]" disabled>
        <Upload className="h-3 w-3 mr-1" />
        Upload (demo)
      </Button>
    </div>
  )
}

function EngineStep({ contractId, onBack, onComplete }: { contractId: string | null; onBack: () => void; onComplete: () => void }) {
  // Previously this step faked a multi-stage forensic-engine progress bar
  // with `setTimeout(r, 500)` per stage and copy that read like a real
  // pipeline ("Blocking: filter candidates by date range + keyword/embedding
  // overlap", "Scoring: semantic_similarity × 0.5 + ..."). That was
  // misleading — the actual engine (§9.1 entity resolution + §9.3 rules
  // engine) is not implemented yet. The honest version below shows what
  // WAS done (LLM contract extraction persisted in step 3) and what's NOT
  // done yet (cross-system entity resolution, deterministic gap rules).
  return (
    <div>
      <h3 className="text-sm font-medium">5. Contract extraction complete</h3>
      <p className="text-xs text-muted-foreground mt-1">
        The SOW text was passed through the LLM extraction pipeline and a structured contract record
        {contractId ? ' was persisted' : ' was returned (not persisted)'}.
      </p>

      <div className="mt-4 p-4 rounded border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/20">
        <div className="flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-600 dark:text-emerald-300" />
          <div className="text-xs">
            <div className="font-medium text-emerald-900 dark:text-emerald-200">Contract extraction</div>
            <div className="text-emerald-700 dark:text-emerald-300 mt-0.5">
              Line items, milestones, and exclusions were parsed from the SOW and stored.
              {contractId && <span className="font-mono text-[10px]"> ref: {contractId.slice(-8)}</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 p-4 rounded border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20">
        <div className="flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-300" />
          <div className="text-xs">
            <div className="font-medium text-amber-900 dark:text-amber-200">Forensic reconciliation — roadmap</div>
            <div className="text-amber-700 dark:text-amber-300 mt-0.5">
              The full forensic engine (§9.1 entity resolution across GitHub / Jira / invoices + §9.3 deterministic
              gap-detection rules + §9.4 decomposed confidence scoring) is on the roadmap. For this demo, no
              findings are auto-generated from the extracted contract — see the review queue for pre-seeded
              examples of what those findings will look like.
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 flex justify-between">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1" />
          Back
        </Button>
        <Button
          onClick={onComplete}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          View review queue
          <ArrowRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      </div>
    </div>
  )
}
