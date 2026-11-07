import { CircleCheck, CircleHelp, CircleX, Loader2, RotateCcw, ShieldCheck, TriangleAlert, WifiOff } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { Card } from '../components/Layout'
import { centsToInput, formatBpsPercent, formatCents, formatHealthFactor, parseEurosToCents } from '../lib/format'
import { RiskApiError } from '../services/errors'
import { evaluateScenarios } from '../services/mockRiskApi'
import { apiMode, riskApi } from '../services/riskApi'
import type { EvaluateRequest, EvaluateResponse, RiskLevel } from '../types/api'

type Form = { quantity: string; price: string; debt: string }
const EMPTY: Form = { quantity: '', price: '', debt: '' }

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; request: EvaluateRequest; data: EvaluateResponse }
  | { status: 'error'; error: RiskApiError }

/** Libellés des niveaux connus. Le contrat ne documente que "healthy". */
const RISK_LABELS: Record<string, { label: string; tone: string }> = {
  healthy: { label: 'Saine', tone: 'border-safe text-safe' },
}

function validate(f: Form): { request?: EvaluateRequest; errors: Partial<Record<keyof Form, string>> } {
  const errors: Partial<Record<keyof Form, string>> = {}
  const q = f.quantity.trim()
  if (!/^\d+$/.test(q) || Number(q) <= 0) errors.quantity = 'Entrez un nombre entier d’actions supérieur à 0.'
  const price = parseEurosToCents(f.price)
  if (price === null || price <= 0) errors.price = 'Entrez un prix en euros, par exemple 100 ou 65,70.'
  const debt = parseEurosToCents(f.debt)
  if (debt === null) errors.debt = 'Entrez une dette en euros (0 si aucune dette).'
  if (Object.keys(errors).length) return { errors }
  return { errors, request: { collateral_quantity: Number(q), collateral_price_cents: price!, debt_cents: debt! } }
}

export function EvaluatePage() {
  const [form, setForm] = useState<Form>(EMPTY)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof Form, string>>>({})
  const [state, setState] = useState<State>({ status: 'idle' })
  const callId = useRef(0)

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })

  async function evaluate(request: EvaluateRequest) {
    const id = ++callId.current
    setState({ status: 'loading' })
    try {
      const data = await riskApi.evaluate(request)
      if (id === callId.current) setState({ status: 'success', request, data })
    } catch (e) {
      if (id !== callId.current) return
      setState({ status: 'error', error: e instanceof RiskApiError ? e : new RiskApiError('unexpected', 'Erreur inattendue.') })
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const { request, errors } = validate(form)
    setFieldErrors(errors)
    if (request) void evaluate(request)
  }

  function loadExample(id: string) {
    const s = evaluateScenarios.find((x) => x.id === id)
    if (!s) return
    const r = s.request
    setForm({ quantity: String(r.collateral_quantity), price: centsToInput(r.collateral_price_cents), debt: centsToInput(r.debt_cents) })
    setFieldErrors({})
    setState({ status: 'idle' })
  }

  function reset() {
    callId.current++
    setForm(EMPTY)
    setFieldErrors({})
    setState({ status: 'idle' })
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="label-mono mb-2 text-accent">Simulateur de risque · API</p>
        <h1 className="title-xl">Évaluer une position</h1>
        <p className="mt-3 text-sm text-muted">
          Indiquez vos actions en garantie et votre dette. Le résultat vient {apiMode === 'http' ? 'du backend UnlockShares' : 'de réponses simulées'}.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card title="Votre position">
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <Field id="quantity" label="Quantité d’actions" hint="Nombre entier" value={form.quantity} onChange={set('quantity')} error={fieldErrors.quantity} inputMode="numeric" />
            <Field id="price" label="Prix unitaire (€)" hint="Ex. 100,00" value={form.price} onChange={set('price')} error={fieldErrors.price} inputMode="decimal" />
            <Field id="debt" label="Dette (€)" hint="0 si aucune dette" value={form.debt} onChange={set('debt')} error={fieldErrors.debt} inputMode="decimal" />

            <div className="flex flex-wrap gap-2 pt-1">
              <button type="submit" disabled={state.status === 'loading'} className="btn primary">
                {state.status === 'loading' && <Loader2 className="size-4 animate-spin" aria-hidden />}
                Évaluer
              </button>
              <label className="sr-only" htmlFor="example">Charger un exemple</label>
              <select id="example" value="" onChange={(e) => loadExample(e.target.value)} className="btn appearance-none pr-4">
                <option value="" disabled>Charger un exemple</option>
                {evaluateScenarios.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}{s.source !== 'contrat' ? ' (hypothèse)' : ''}</option>
                ))}
              </select>
              <button type="button" onClick={reset} className="btn">
                <RotateCcw className="size-4" aria-hidden /> Réinitialiser
              </button>
            </div>
          </form>
        </Card>

        <div aria-live="polite">
          <Result state={state} />
        </div>
      </div>
    </div>
  )
}

function Field(props: { id: string; label: string; hint: string; value: string; error?: string; inputMode: 'numeric' | 'decimal'; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  const { id, label, hint, value, error, inputMode, onChange } = props
  return (
    <div>
      <label htmlFor={id} className="label-mono block">{label}</label>
      <input
        id={id}
        value={value}
        onChange={onChange}
        inputMode={inputMode}
        autoComplete="off"
        aria-invalid={!!error}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
        className={`mt-1.5 w-full rounded-xl border bg-bg px-3 py-2.5 text-base text-ink tabular-nums outline-none focus:border-accent focus:ring-1 focus:ring-accent ${error ? 'border-danger' : 'border-line'}`}
      />
      <p id={`${id}-hint`} className="mt-1 text-xs text-muted">{hint}</p>
      {error && <p id={`${id}-error`} className="mt-1 text-xs font-medium text-danger">{error}</p>}
    </div>
  )
}

function Result({ state }: { state: State }) {
  if (state.status === 'idle')
    return (
      <Card title="Résultat">
        <p className="text-sm text-muted">Remplissez le formulaire puis cliquez sur « Évaluer », ou chargez un exemple.</p>
      </Card>
    )
  if (state.status === 'loading')
    return (
      <Card title="Résultat">
        <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" aria-hidden /> Évaluation en cours…</p>
      </Card>
    )
  if (state.status === 'error') return <ErrorBox error={state.error} />

  const { data } = state
  const hf = formatHealthFactor(data.health_factor_bps)
  return (
    <Card title="Résultat">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <RiskBadge level={data.risk_level} />
        <OpeningBadge allowed={data.opening_allowed} />
      </div>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Stat label="Valeur du collatéral" value={formatCents(data.collateral_value_cents)} />
        <Stat label="Dette" value={formatCents(data.debt_cents)} />
        <Stat label="LTV (dette / collatéral)" value={formatBpsPercent(data.ltv_bps)} />
        <Stat
          label="Health Factor"
          value={hf ?? 'Non applicable'}
          note={hf ? 'Au-dessus de 1 : position non liquidable.' : 'Aucune dette : le Health Factor ne s’applique pas.'}
        />
      </dl>
      <p className="mt-4 font-mono text-[11px] text-muted">
        {apiMode === 'http' ? 'Valeurs renvoyées par le backend.' : 'Valeurs simulées (mode démonstration), aucun appel au backend.'}
      </p>
    </Card>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-line bg-bg p-3">
      <dt className="label-mono">{label}</dt>
      <dd className="mt-1.5 font-display text-2xl font-black tabular-nums">{value}</dd>
      {note && <dd className="mt-1 text-xs text-muted">{note}</dd>}
    </div>
  )
}

function RiskBadge({ level }: { level: RiskLevel }) {
  const known = RISK_LABELS[level]
  if (!known)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-muted px-3 py-1 text-sm font-semibold text-muted">
        <CircleHelp className="size-4" aria-hidden /> Niveau non documenté : « {level} »
      </span>
    )
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold ${known.tone}`}>
      <ShieldCheck className="size-4" aria-hidden /> Risque : {known.label}
    </span>
  )
}

function OpeningBadge({ allowed }: { allowed: boolean }) {
  const Icon = allowed ? CircleCheck : CircleX
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold ${allowed ? 'border-safe text-safe' : 'border-danger text-danger'}`}>
      <Icon className="size-4" aria-hidden /> Ouverture d’un prêt : {allowed ? 'autorisée' : 'refusée'}
    </span>
  )
}

const ERROR_TITLES: Record<RiskApiError['kind'], string> = {
  business: 'Demande refusée par le service',
  http: 'Erreur du serveur',
  network: 'Serveur injoignable',
  unexpected: 'Réponse inattendue',
  config: 'Configuration incomplète',
  'mock-unavailable': 'Scénario simulé indisponible',
}

function ErrorBox({ error }: { error: RiskApiError }) {
  const Icon = error.kind === 'network' ? WifiOff : TriangleAlert
  return (
    <div role="alert" className="rounded-2xl border border-danger bg-surface p-4 text-ink">
      <p className="flex items-center gap-2 font-semibold text-danger"><Icon className="size-4" aria-hidden /> {ERROR_TITLES[error.kind]}</p>
      <p className="mt-1 text-sm">{error.message}</p>
      {error.status && <p className="mt-1 font-mono text-[11px] text-muted">Statut HTTP : {error.status}</p>}
    </div>
  )
}
