'use client'

import { useEffect, useState, useRef } from 'react'
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
  FileText, GitBranch, ClipboardList, Loader2,
  CheckCircle2, ArrowRight, ArrowLeft, Sparkles, X,
  IndianRupee, Building2, AlertCircle, Upload,
  Link2, Globe, Github, FileUp, AlertTriangle,
} from 'lucide-react'
import { formatINR, formatDate } from '@/lib/gavel'
import { apiPost } from '@/lib/fetch'
import { ConnectorPanel } from './connector-panel'

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

/** Where the SOW text came from — recorded on the contract as a
 *  provenance header and shown as a badge so the evidence chain is
 *  self-documenting (fetched/uploaded vs hand-pasted). */
interface SowProvenance {
  kind: 'url' | 'github' | 'upload'
  label: string
  bytes: number
}

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
  const [provenance, setProvenance] = useState<SowProvenance | null>(null)
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
      setProvenance(null)
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
    // Provenance header: flows into contract.rawText so the stored
    // evidence self-documents its origin. Deliberately timestamp-free —
    // identical fetches produce identical rawText, preserving the
    // extract route's idempotency (same text → same contract).
    const rawText = provenance
      ? `[Imported from ${provenance.label}]\n\n${sowText}`
      : sowText
    try {
      const res = await fetch('/api/extract-contract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText, clientId, persist: true }),
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
      {/* NOTE: width must be sm:max-w-3xl (not bare max-w-3xl) — the base
         DialogContent class ships `sm:max-w-lg`, and tailwind-merge only
         dedupes within the same variant group. Bare max-w-3xl loses to
         sm:max-w-lg at ≥640px viewports and the modal silently renders at
         512px, clipping the stepper and squeezing every step. */}
      <DialogContent className="sm:max-w-3xl max-h-[90vh] p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b border-border bg-muted/30">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-primary" />
                New forensic audit
              </DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                Multi-step intake: client → SOW → LLM extraction → review → evidence upload → forensic engine
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
                provenance={provenance}
                setProvenance={setProvenance}
                onLoadSample={() => { setSowText(SAMPLE_SOW); setProvenance(null) }}
                onBack={() => setStep('client')}
                onNext={startExtraction}
              />
            )}

            {step === 'extracting' && (
              <div className="py-16 flex flex-col items-center text-center">
                <Loader2 className="h-8 w-8 text-primary animate-spin" />
                <h3 className="mt-4 text-sm font-medium">Extracting contract structure</h3>
                <p className="mt-1 text-xs text-muted-foreground max-w-md">
                  Calling the LLM against a fixed JSON schema, then validating every field with
                  deterministic rules (dates parse, amounts parse). If the output fails validation
                  it is re-prompted — up to 3 attempts — never salvaged with regex. Extraction output
                  is never trusted directly into a finding; a human reviews it next.
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
                clientId={activeClientId || selectedClientId}
                onBack={() => setStep('review')}
                onNext={() => setStep('engine')}
              />
            )}

            {step === 'engine' && (
              <EngineStep
                clientId={activeClientId || selectedClientId}
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
    { id: 'delivery', label: 'Evidence' },
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
          Next: provide SOW
          <ArrowRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      </div>
    </div>
  )
}

type SourceMode = 'paste' | 'upload' | 'link'

const fmtBytes = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`

function SowStep({
  sowText, setSowText, onLoadSample, onBack, onNext, provenance, setProvenance,
}: {
  sowText: string
  setSowText: (s: string) => void
  onLoadSample: () => void
  onBack: () => void
  onNext: () => void
  provenance: SowProvenance | null
  setProvenance: (p: SowProvenance | null) => void
}) {
  const [mode, setMode] = useState<SourceMode>('paste')
  const [linkKind, setLinkKind] = useState<'url' | 'github'>('url')
  const [fetching, setFetching] = useState(false)
  const [fetchErr, setFetchErr] = useState<string | null>(null)

  // url fields
  const [url, setUrl] = useState('')

  // github fields
  const [ghOwner, setGhOwner] = useState('')
  const [ghRepo, setGhRepo] = useState('')
  const [ghPath, setGhPath] = useState('')
  const [ghRef, setGhRef] = useState('')
  const [ghToken, setGhToken] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  interface FetchResponse {
    text: string
    source: { kind: string; label: string; bytes: number }
  }

  async function runFetch(body: Record<string, unknown>) {
    setFetching(true)
    setFetchErr(null)
    const { data, error } = await apiPost<FetchResponse>('/api/sources/fetch', body)
    setFetching(false)
    if (error || !data) {
      setFetchErr(error?.message ?? 'fetch failed')
      toast.error('Could not fetch source', { description: error?.message ?? 'unknown error' })
      return
    }
    setSowText(data.text)
    setProvenance({
      kind: data.source.kind === 'url' ? 'url' : 'github',
      label: data.source.label,
      bytes: data.source.bytes,
    })
    toast.success('Source fetched', {
      description: `${fmtBytes(data.source.bytes)} — review the text below, then extract.`,
    })
  }

  async function onFile(f: File) {
    if (f.size > 2 * 1024 * 1024) {
      toast.error('File too large', { description: 'keep SOW text files under 2 MB' })
      return
    }
    try {
      const text = await f.text()
      setSowText(text)
      setProvenance({ kind: 'upload', label: f.name, bytes: f.size })
      toast.success('File loaded', { description: `${f.name} · ${fmtBytes(f.size)} — editable below.` })
    } catch {
      toast.error('Could not read file')
    }
  }

  const urlFetchDisabled = fetching || !url.trim().startsWith('https://')
  const ghFetchDisabled = fetching || !ghOwner.trim() || !ghRepo.trim() || !ghPath.trim()

  const MODES: Array<{ id: SourceMode; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'paste', label: 'Paste text', icon: FileText },
    { id: 'upload', label: 'Upload file', icon: FileUp },
    { id: 'link', label: 'Link service / URL', icon: Link2 },
  ]

  return (
    <div>
      <h3 className="text-sm font-medium">2. Provide the SOW / contract</h3>
      <p className="text-xs text-muted-foreground mt-1">
        Pull it from where it already lives — a published URL, a GitHub repo file, or a
        text upload — or paste it. However it arrives, the text below stays editable and
        a human reviews the extraction before anything is asserted.
      </p>

      {/* ── Source mode tabs ─────────────────────────────────────────── */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        {MODES.map(m => {
          const active = m.id === mode
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => { setMode(m.id); setFetchErr(null) }}
              className={`flex items-center gap-1.5 rounded-lg border p-2.5 text-xs transition-colors ${
                active
                  ? 'border-primary bg-primary/5 text-foreground'
                  : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
              }`}
            >
              <m.icon className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-primary' : ''}`} />
              <span className="font-medium truncate">{m.label}</span>
            </button>
          )
        })}
      </div>

      {/* ── Mode affordances ─────────────────────────────────────────── */}
      {mode === 'paste' && (
        <div className="mt-3 flex justify-end">
          <Button variant="outline" size="sm" onClick={onLoadSample}>
            <FileText className="h-3.5 w-3.5 mr-1" />
            Load sample SOW
          </Button>
        </div>
      )}

      {mode === 'upload' && (
        <div className="mt-3">
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.markdown,.csv,.json,.text,text/*"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) void onFile(f)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border hover:border-primary/50 hover:bg-muted/30 transition-colors py-7 px-4"
          >
            <FileUp className="h-5 w-5 text-muted-foreground" />
            <span className="text-xs font-medium">Choose a text file</span>
            <span className="text-[10px] text-muted-foreground">
              .txt · .md · .csv · .json — read locally in your browser, up to 2 MB
            </span>
          </button>
        </div>
      )}

      {mode === 'link' && (
        <div className="mt-3 rounded-lg border bg-muted/20 p-3">
          {/* Link sub-tabs: URL | GitHub */}
          <div className="grid grid-cols-2 gap-2">
            {(['url', 'github'] as const).map(k => (
              <button
                key={k}
                type="button"
                onClick={() => { setLinkKind(k); setFetchErr(null) }}
                className={`flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs transition-colors ${
                  linkKind === k
                    ? 'border-primary bg-primary/5 text-foreground font-medium'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {k === 'url' ? <Globe className="h-3.5 w-3.5" /> : <Github className="h-3.5 w-3.5" />}
                {k === 'url' ? 'Published URL' : 'GitHub repo file'}
              </button>
            ))}
          </div>

          {linkKind === 'url' ? (
            <div className="mt-3 space-y-2">
              <Label htmlFor="sow-url" className="text-xs">
                https:// URL of the SOW text
              </Label>
              <div className="flex gap-2">
                <Input
                  id="sow-url"
                  placeholder="https://docs.google.com/document/d/…/pub  ·  https://confluence…  ·  any raw text link"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  className="num text-xs"
                />
                <Button
                  size="sm"
                  className="bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
                  disabled={urlFetchDisabled}
                  onClick={() => void runFetch({ kind: 'url', url: url.trim() })}
                >
                  {fetching ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Globe className="h-3.5 w-3.5 mr-1" />}
                  Fetch
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Server-side fetch with SSRF guards (https-only, private networks blocked,
                2 MB cap). HTML pages are stripped to text; PDFs/DOCX must be converted
                or uploaded as text first.
              </p>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="gh-o" className="text-xs">Owner / org</Label>
                  <Input id="gh-o" placeholder="acme-corp" value={ghOwner}
                    onChange={e => setGhOwner(e.target.value)} className="num text-xs" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gh-r" className="text-xs">Repository</Label>
                  <Input id="gh-r" placeholder="vendor-contracts" value={ghRepo}
                    onChange={e => setGhRepo(e.target.value)} className="num text-xs" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="gh-p" className="text-xs">File path</Label>
                  <Input id="gh-p" placeholder="docs/sow-2025.md" value={ghPath}
                    onChange={e => setGhPath(e.target.value)} className="num text-xs" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gh-b" className="text-xs">
                    Branch / tag <span className="text-muted-foreground/60">(optional)</span>
                  </Label>
                  <Input id="gh-b" placeholder="main" value={ghRef}
                    onChange={e => setGhRef(e.target.value)} className="num text-xs" />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="gh-t" className="text-xs">
                  Personal access token <span className="text-muted-foreground/60">(optional — public repos work without)</span>
                </Label>
                <Input id="gh-t" type="password" placeholder="ghp_… (used once for this fetch, never stored)"
                  value={ghToken} onChange={e => setGhToken(e.target.value)} className="num text-xs" />
              </div>
              <Button
                size="sm"
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                disabled={ghFetchDisabled}
                onClick={() =>
                  void runFetch({
                    kind: 'github',
                    owner: ghOwner.trim(),
                    repo: ghRepo.trim(),
                    path: ghPath.trim().replace(/^\/+/, ''),
                    ...(ghRef.trim() ? { ref: ghRef.trim() } : {}),
                    ...(ghToken.trim() ? { token: ghToken.trim() } : {}),
                  })
                }
              >
                {fetching ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Github className="h-3.5 w-3.5 mr-1" />}
                Fetch file from GitHub
              </Button>
              <p className="text-[10px] text-muted-foreground">
                Same GitHub API access as the Evidence-step connectors — the token is
                used for this single request and never persisted (saved connectors seal
                theirs with AES-256-GCM).
              </p>
            </div>
          )}

          {fetchErr && (
            <div className="mt-2 flex items-start gap-1.5 rounded border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/20 p-2 text-xs">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-rose-600 dark:text-rose-300" />
              <span className="text-rose-700 dark:text-rose-300">{fetchErr}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Provenance badge ─────────────────────────────────────────── */}
      {provenance && (
        <div className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          {provenance.kind === 'github' ? <Github className="h-3 w-3" /> : provenance.kind === 'url' ? <Globe className="h-3 w-3" /> : <FileUp className="h-3 w-3" />}
          <span className="num truncate max-w-[85%]">
            imported from <span className="text-foreground font-medium">{provenance.label}</span> · {fmtBytes(provenance.bytes)}
          </span>
          <button
            type="button"
            className="ml-auto shrink-0 text-primary underline underline-offset-2"
            onClick={() => setProvenance(null)}
            title="Drop the origin note (the text below stays)"
          >
            clear origin
          </button>
        </div>
      )}

      {/* ── The (always editable) review textarea ───────────────────── */}
      <Textarea
        value={sowText}
        onChange={(e) => setSowText(e.target.value)}
        placeholder={
          mode === 'paste'
            ? 'Paste the full SOW text here — section headings, scope items, rate card, milestones, change-order policy, exclusions…'
            : 'Fetched / uploaded text lands here for review — or paste directly if you switch modes.'
        }
        rows={14}
        // field-sizing-fixed overrides the base `field-sizing-content`:
        // auto-sizing inside Radix ScrollArea's display:table viewport lets
        // the textarea expand to its longest unwrapped line, clipping
        // milestone amounts at the dialog edge. Fixed sizing restores
        // soft-wrap + the rows height + an internal scrollbar.
        className="mt-3 font-mono text-xs field-sizing-fixed resize-y"
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

// ─────────────────────────── Step 4: evidence upload ───────────────────────────

type IngestSourceType = 'jira-tickets' | 'github-commits' | 'invoice-lines'

const SOURCE_CARDS: Array<{
  id: IngestSourceType
  icon: React.ComponentType<{ className?: string }>
  title: string
  sub: string
  sample: string
}> = [
  { id: 'jira-tickets', icon: ClipboardList, title: 'Jira / Linear tickets', sub: 'key, summary, status, dates', sample: 'jira-tickets.sample.csv' },
  { id: 'github-commits', icon: GitBranch, title: 'GitHub / GitLab activity', sub: 'sha/PR, message, author, date', sample: 'github-commits.sample.csv' },
  { id: 'invoice-lines', icon: IndianRupee, title: 'Invoice lines', sub: 'invoice no, date, item, amount', sample: 'invoice-lines.sample.csv' },
]

interface IngestResponse {
  ok: boolean
  error?: string
  parsed?: number
  valid?: number
  invalid?: number
  errors?: Array<{ row: number; field: string; message: string }>
  preview?: Array<Record<string, unknown>>
  committed?: {
    created: number
    updated: number
    duplicates: number
    invoicesCreated: number
    linesCreated: number
    linesSkippedExistingInvoice: number
  }
}

function DeliveryStep({
  clientId,
  onBack,
  onNext,
}: {
  clientId: string
  onBack: () => void
  onNext: () => void
}) {
  const [sourceType, setSourceType] = useState<IngestSourceType>('jira-tickets')
  const [phase, setPhase] = useState<'idle' | 'working' | 'preview' | 'imported'>('idle')
  const [preview, setPreview] = useState<IngestResponse | null>(null)
  const [ingestError, setIngestError] = useState<string | null>(null)
  const [imported, setImported] = useState<Array<{ label: string; detail: string }>>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingFileRef = useRef<File | null>(null)

  const postIngest = async (file: File, dryRun: boolean): Promise<IngestResponse> => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('sourceType', sourceType)
    fd.append('clientId', clientId)
    fd.append('dryRun', dryRun ? 'true' : 'false')
    const res = await fetch('/api/ingest', { method: 'POST', body: fd })
    return (await res.json()) as IngestResponse
  }

  const runPreview = async (file: File) => {
    pendingFileRef.current = file
    setPhase('working')
    setIngestError(null)
    setPreview(null)
    try {
      const d = await postIngest(file, true)
      if (!d.ok) {
        setIngestError(d.error ?? 'upload rejected')
        setPhase('idle')
        toast.error('Upload rejected', { description: d.error })
        return
      }
      setPreview(d)
      setPhase('preview')
    } catch (e) {
      setIngestError(e instanceof Error ? e.message : 'network error')
      setPhase('idle')
    }
  }

  const runImport = async () => {
    const file = pendingFileRef.current
    if (!file) return
    setPhase('working')
    try {
      const d = await postIngest(file, false)
      if (!d.ok || !d.committed) {
        setIngestError(d.error ?? 'import failed')
        setPhase('preview')
        toast.error('Import failed', { description: d.error })
        return
      }
      const c = d.committed
      const detail =
        sourceType === 'invoice-lines'
          ? `${c.invoicesCreated} invoice(s), ${c.linesCreated} line(s)` +
            (c.linesSkippedExistingInvoice ? `, ${c.linesSkippedExistingInvoice} skipped (invoice on file)` : '')
          : `${c.created} created, ${c.updated} updated` +
            (c.duplicates ? `, ${c.duplicates} duplicate(s) skipped` : '')
      setImported(prev => [...prev, { label: `${file.name} · ${sourceType}`, detail }])
      setPhase('imported')
      setPreview(null)
      pendingFileRef.current = null
      toast.success('Evidence imported', { description: detail })
    } catch (e) {
      setIngestError(e instanceof Error ? e.message : 'network error')
      setPhase('preview')
    }
  }

  const loadSample = async () => {
    const sampleCard = SOURCE_CARDS.find(c => c.id === sourceType)
    if (!sampleCard) return
    try {
      const res = await fetch(`/ingest-samples/${sampleCard.sample}`)
      if (!res.ok) throw new Error('sample not found')
      const blob = await res.blob()
      await runPreview(new File([blob], sampleCard.sample, { type: 'text/csv' }))
    } catch (e) {
      toast.error('Could not load sample', { description: e instanceof Error ? e.message : 'unknown' })
    }
  }

  return (
    <div>
      <h3 className="text-sm font-medium">4. Delivery &amp; billing evidence</h3>
      <p className="text-xs text-muted-foreground mt-1">
        Attach the client&apos;s delivery and billing records — the engine
        reconciles them against the contract you just intaked. Upload CSV/JSON
        exports (validated first, preview below; re-uploads are a no-op), or
        pull live from GitHub / Jira with a saved connector below — both feed
        the exact same pipeline.
      </p>

      {/* Source type selector */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        {SOURCE_CARDS.map(c => {
          const active = c.id === sourceType
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => { setSourceType(c.id); setPhase('idle'); setPreview(null); setIngestError(null) }}
              className={`text-left rounded-lg border p-3 transition-colors ${
                active
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/40'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <c.icon className={`h-3.5 w-3.5 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                <div className="text-xs font-medium">{c.title}</div>
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">{c.sub}</div>
            </button>
          )
        })}
      </div>

      {/* File picker + sample */}
      <div className="mt-3 flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.json"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) void runPreview(f)
            e.target.value = ''
          }}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={phase === 'working' || !clientId}
        >
          <Upload className="h-3.5 w-3.5 mr-1.5" />
          Choose file (.csv / .json)
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void loadSample()} disabled={phase === 'working'}>
          Load sample data
        </Button>
        {!clientId && (
          <span className="text-[10px] text-destructive">select a client first</span>
        )}
      </div>

      {/* Working spinner */}
      {phase === 'working' && (
        <div className="mt-4 py-6 flex flex-col items-center text-center">
          <Loader2 className="h-5 w-5 text-primary animate-spin" />
          <p className="mt-2 text-xs text-muted-foreground">Validating upload…</p>
        </div>
      )}

      {/* Error */}
      {ingestError && phase !== 'working' && (
        <div className="mt-4 p-3 rounded border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/20 text-xs">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 text-rose-600 dark:text-rose-300 shrink-0" />
            <div>
              <div className="font-medium text-rose-900 dark:text-rose-200">Upload rejected</div>
              <div className="text-rose-700 dark:text-rose-300 mt-0.5">{ingestError}</div>
            </div>
          </div>
        </div>
      )}

      {/* Preview */}
      {phase === 'preview' && preview && (
        <div className="mt-4">
          <div className="grid grid-cols-3 gap-2">
            <Tile label="Rows parsed" value={String(preview.parsed ?? 0)} />
            <Tile label="Valid" value={String(preview.valid ?? 0)} />
            <Tile label="Rejected" value={String(preview.invalid ?? 0)} />
          </div>

          {(preview.errors?.length ?? 0) > 0 && (
            <div className="mt-3 p-3 rounded border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 text-xs max-h-32 overflow-y-auto scrollbar-thin">
              <div className="font-medium text-amber-900 dark:text-amber-200 mb-1">
                {preview.errors?.length} row(s) will be skipped:
              </div>
              <ul className="space-y-0.5">
                {preview.errors?.slice(0, 5).map((e, i) => (
                  <li key={i} className="text-amber-800 dark:text-amber-300">
                    row {e.row} · {e.field}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.preview && preview.preview.length > 0 && (
            <div className="mt-3 rounded border border-border overflow-hidden">
              <table className="w-full text-[10px]">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    {Object.keys(preview.preview[0] as Record<string, unknown>).slice(0, 5).map(h => (
                      <th key={h} className="text-left px-2 py-1.5 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.preview.slice(0, 5).map((row, i) => (
                    <tr key={i} className="border-t border-border">
                      {Object.values(row).slice(0, 5).map((v, j) => (
                        <td key={j} className="px-2 py-1.5 max-w-40 truncate">{String(v ?? '')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-3 flex items-center gap-2">
            <Button
              size="sm"
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => void runImport()}
              disabled={(preview.valid ?? 0) === 0}
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
              Import {preview.valid ?? 0} valid record{(preview.valid ?? 0) === 1 ? '' : 's'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setPhase('idle'); setPreview(null); pendingFileRef.current = null }}
            >
              Choose a different file
            </Button>
          </div>
        </div>
      )}

      {/* Imported summary — stack multiple uploads */}
      {imported.length > 0 && (
        <div className="mt-4 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Imported this session</div>
          {imported.map((im, i) => (
            <div key={i} className="flex items-start gap-2 p-2 rounded border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/20 text-xs">
              <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-emerald-600 dark:text-emerald-300 shrink-0" />
              <div>
                <div className="font-medium">{im.label}</div>
                <div className="text-[10px] text-muted-foreground">{im.detail}</div>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="text-[10px] text-primary underline underline-offset-2"
            onClick={() => setPhase('idle')}
          >
            upload another file
          </button>
        </div>
      )}

      <p className="mt-3 text-[10px] text-muted-foreground">
        Dates accept ISO (YYYY-MM-DD) or dd/mm/yyyy. Amounts may carry ₹/$ and thousand
        separators. One bad row never rejects the file — it is skipped and reported.
      </p>

      {/* Live connectors — pull straight from GitHub / Jira */}
      <div className="mt-5 rounded-lg border bg-muted/20 p-4">
        <ConnectorPanel clientId={clientId} />
      </div>

      <div className="mt-5 flex justify-between">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
          Back
        </Button>
        <Button onClick={onNext} className="bg-primary text-primary-foreground hover:bg-primary/90">
          Run forensic engine
          <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
        </Button>
      </div>
    </div>
  )
}

interface ReconcileResult {
  ok: boolean
  created: number
  updated: number
  skipped: number
  adopted: number
  findings: Array<{
    type: string
    title: string
    summary: string
    impactAmount: number | null
    confidence: string
  }>
}

function EngineStep({
  clientId,
  contractId,
  onBack,
  onComplete,
}: {
  clientId: string
  contractId: string | null
  onBack: () => void
  onComplete: () => void
}) {
  // This step RUNS the real deterministic reconciliation engine
  // (POST /api/audits/[clientId]/reconcile - §9.3 rules against contract +
  // delivery + billing rows) and shows its actual output. An earlier
  // version of this step showed a static "engine is on the roadmap" panel
  // with a fake setTimeout progress bar - the engine existed by then; the
  // panel was stale. This is the wired version.
  const [result, setResult] = useState<ReconcileResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const res = await fetch(`/api/audits/${clientId}/reconcile`, { method: 'POST' })
        const d = await res.json()
        if (!cancelled) {
          if (d.ok) setResult(d)
          else setError(d.error ?? 'reconcile failed')
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'network error')
      }
    }
    run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  const findingCount = result ? result.findings.length : 0

  return (
    <div>
      <h3 className="text-sm font-medium">5. Forensic engine</h3>
      <p className="text-xs text-muted-foreground mt-1">
        Running the deterministic reconciliation engine against the contract
        {contractId ? ' (persisted in step 3)' : ''} and every delivery + billing
        record linked to this client.
      </p>

      {!result && !error && (
        <div className="mt-8 py-10 flex flex-col items-center text-center">
          <Loader2 className="h-7 w-7 text-primary animate-spin" />
          <p className="mt-3 text-xs text-muted-foreground">
            Reconciling milestones, line items, and exclusions against tickets, code
            activity, and invoices…
          </p>
        </div>
      )}

      {error && (
        <div className="mt-4 p-4 rounded border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/20">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 text-rose-600 dark:text-rose-300" />
            <div className="text-xs">
              <div className="font-medium text-rose-900 dark:text-rose-200">Engine run failed</div>
              <div className="text-rose-700 dark:text-rose-300 mt-0.5">{error}</div>
            </div>
          </div>
        </div>
      )}

      {result && (
        <>
          <div className="mt-4 grid grid-cols-4 gap-2">
            <Tile label="New findings" value={String(result.created)} />
            <Tile label="Updated" value={String(result.updated)} />
            <Tile label="Unchanged" value={String(result.skipped)} />
            <Tile label="Total" value={String(findingCount)} />
          </div>

          {findingCount > 0 ? (
            <div className="mt-4 space-y-2 max-h-56 overflow-y-auto scrollbar-thin">
              {result.findings.map((f, i) => (
                <div key={i} className="flex items-start justify-between gap-3 p-2.5 rounded border border-border text-xs">
                  <div className="min-w-0">
                    <div className="font-medium leading-snug">{f.title}</div>
                    <div className="text-[10px] text-muted-foreground mt-1">{f.type.replace(/_/g, ' ')} · {f.confidence} confidence</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-medium text-primary">{formatINR(f.impactAmount)}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 p-4 rounded border border-dashed border-border bg-muted/30 text-xs text-muted-foreground">
              <strong className="text-foreground">No findings.</strong> The engine ran
              against everything linked to this client. If no delivery or billing evidence
              has been attached yet, upload CSV/JSON exports in the previous step (or load
              the bundled samples) — the engine reconciles whatever is on file. The seeded
              demo client has full delivery data — reconcile it from the Audits view to see
              findings come out.
            </div>
          )}

          <p className="mt-3 text-[10px] text-muted-foreground">
            Findings are persisted idempotently — re-running the engine updates evidence
            on existing findings instead of duplicating them, and never touches findings
            a reviewer has already acted on.
          </p>
        </>
      )}

      <div className="mt-5 flex justify-between">
        <Button variant="outline" onClick={onBack} disabled={!result && !error}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
          Back
        </Button>
        <Button
          onClick={onComplete}
          disabled={!result && !error}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          View review queue
          <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
        </Button>
      </div>
    </div>
  )
}
