// Petits blocs visuels de la maquette V3 (jauge, bocal d'actions, fenêtre d'action, toast).
import { ListFilter, Search, X } from 'lucide-react'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { StellarLogo, TokenLogo, type TokenKind } from './logos'
import { useDemo } from '../lib/useDemo'
import { actions, chainReady, type Done, type Kind } from '../services/app'
import { lienTx } from '../services/chain'
import { DEMO, derive, zoneOf } from '../services/mockDemo'

export const eur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`
export const usdc = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} USDC`

/** Terme DeFi affiché seulement quand l'option « Afficher les termes DeFi » est cochée */
export const Term = ({ children }: { children: ReactNode }) => <span className="term">{children}</span>

export const Pill = ({ cls, children }: { cls: string; children: ReactNode }) => <span className={`pill ${cls}`}>{children}</span>

export function Coin({ kind, children }: { kind: TokenKind; children: ReactNode }) {
  return <span className={`coin c-${kind}`} title={typeof children === 'string' ? children : undefined}>{TokenLogo({ kind }) ?? children}</span>
}

export const Stack = () => (
  <span className="stack"><span className="c-aapl"><TokenLogo kind="aapl" /></span><span className="c-usdc"><TokenLogo kind="usdc" /></span></span>
)

/** Jauge tricolore : part de la limite utilisée */
export function Gauge({ ltv }: { ltv: number }) {
  const z = zoneOf(ltv)
  const pct = Math.round((ltv / DEMO.liquidation) * 100)
  return (
    <>
      <div className="line">
        <span>You are using <b>{pct} %</b> of your limit<Term>LTV {Math.round(ltv * 100)} % / CF 80 %</Term></span>
        <Pill cls={z.cls}>{z.label}</Pill>
      </div>
      <div className="gwrap">
        <div className="gtrack">
          <b style={{ width: '62.5%', background: 'var(--safe)' }} />
          <b style={{ width: '25%', background: 'var(--watch)' }} />
          <b style={{ width: '12.5%', background: 'var(--danger)' }} />
        </div>
        <div className="gmark" style={{ left: `${Math.min(99.5, pct)}%` }} />
      </div>
    </>
  )
}

export function Ring({ p }: { p: number }) {
  const c = 2 * Math.PI * 7
  return (
    <span className="ringc">
      <svg viewBox="0 0 18 18" aria-hidden>
        <circle cx="9" cy="9" r="7" stroke="var(--line)" strokeWidth="2.5" fill="none" />
        <circle cx="9" cy="9" r="7" stroke="var(--accent)" strokeWidth="2.5" fill="none" strokeDasharray={`${Math.min(1, p) * c} ${c}`} transform="rotate(-90 9 9)" />
      </svg>
      {Math.round(p * 100)} %
    </span>
  )
}

/** Jauge « Votre limite » (LTV / 80 %) avec le repère d'emprunt maximum */
export function LimitBlock() {
  const s = useDemo()
  const d = derive(s)
  return (
    <>
      <div className="line"><span className="muted">Your limit<Term>LTV / collateral factor</Term></span><Pill cls={d.zone.cls}>{d.zone.label}</Pill></div>
      <p className="limitbig num"><b className={d.zone.cls}>{d.usedPct} %</b> of your limit used</p>
      <div className="limit">
        <div className="fill" style={{ width: `${Math.min(100, d.usedPct)}%`, background: d.zone.color }} />
        <span className="tick" style={{ left: `${d.maxBorrowPct}%` }} />
      </div>
      <div className="limitlbl"><span>0 %</span><span style={{ left: `${d.maxBorrowPct}%` }}>Max borrow</span><span>Protection sale</span></div>
      <small className="muted">The protection sale starts when your debt represents 80 % of your collateral.</small>
    </>
  )
}

/** Bocal d'actions : argent reçu / encore disponible / coussin de sécurité */
export function Jar() {
  const s = useDemo()
  const d = derive(s)
  if (!s.shares)
    return (
      <>
        <p className="jarmsg">No shares in the jar yet.</p>
        <p className="muted">Deposit shares to see what they can unlock.</p>
      </>
    )
  const parts: [number, string, string, string][] = [
    [s.debt, 'var(--cash)', 'Cash received', 'debt'],
    [d.available, 'var(--free)', 'Still available', 'borrow capacity'],
    [d.cushion, 'var(--safe)', 'Safety cushion', 'buffer before liquidation'],
  ]
  // Le bocal représente la limite de 80 % : cash reçu + encore disponible + marge.
  const total = Math.max(d.value * DEMO.liquidation, s.debt)
  return (
    <>
      <small className="muted">Your shares jar</small>
      <p className="jarmsg">
        {d.liquidable ? (
          <><em className="s-danger">Your cash is bigger than your limit.</em> The protection sale starts.</>
        ) : d.available > 0 ? (
          <>You own <em className={d.zone.cls}>{eur(d.net)}</em> and can still receive <em>{eur(d.available)}</em>.</>
        ) : (
          <>You own <em className={d.zone.cls}>{eur(d.net)}</em>. Pay back a little to stay safe.</>
        )}
      </p>
      <div className="jar">
        {parts.map(([x, c, t]) => (
          <div key={t} style={{ flexBasis: `${(x / total) * 100}%`, background: c }}>{x / Math.max(d.value, 1) > 0.18 ? eur(x) : ''}</div>
        ))}
      </div>
      <div className="jarleg">
        {parts.map(([x, c, t, k]) => (
          <div key={t}><span><i style={{ background: c }} />{t}<Term>{k}</Term></span><span>{eur(x)}</span></div>
        ))}
        <div className="small muted"><span>{s.shares} Apple shares at {eur(s.price)}</span><span>{eur(d.value)}</span></div>
      </div>
    </>
  )
}

export function Filters({ list, wallet }: { list: string[]; wallet?: boolean }) {
  return (
    <div className="filters">
      <label className="search"><Search className="i" aria-hidden /><input placeholder="Filter assets" aria-label="Filter assets" /></label>
      <div className="chips">
        <span className="chip"><StellarLogo />Stellar</span>
        {list.map((f) => <span key={f} className="chip"><ListFilter className="i" aria-hidden />{f}</span>)}
        {wallet && <span className="chip">In wallet <span className="tog" /></span>}
      </div>
    </div>
  )
}

/* ---------- Fenêtres d'action et toast ---------- */

type Act = { title: string; label: string; def: number; unit: 'USDC' | 'AAPL'; step: number; debt?: (debt: number, a: number) => number; shares?: (sh: number, a: number) => number }
const ACTS: Record<Kind, Act> = {
  lend: { title: 'Lend USDC', label: 'Amount to lend', def: 1000, unit: 'USDC', step: 50 },
  withdrawLend: { title: 'Withdraw lent USDC', label: 'Amount to withdraw', def: 1000, unit: 'USDC', step: 50 },
  deposit: { title: 'Use shares as guarantee', label: 'Number of Apple shares', def: 10, unit: 'AAPL', step: 1, shares: (sh, a) => sh + a },
  withdraw: { title: 'Take shares back', label: 'Number of Apple shares', def: 1, unit: 'AAPL', step: 1, shares: (sh, a) => sh - a },
  borrow: { title: 'Receive cash', label: 'Amount to receive', def: 500, unit: 'USDC', step: 50, debt: (d, a) => d + a },
  repay: { title: 'Pay back', label: 'Amount to pay back', def: 500, unit: 'USDC', step: 50, debt: (d, a) => d - a },
}

type Ui = { open: (k: Kind) => void; toast: (t: string | Done) => void; /** Montant du dernier emprunt réussi (pour proposer « Cash out ») */ lastBorrow: number | null }
const UiContext = createContext<Ui>({ open: () => {}, toast: () => {}, lastBorrow: null })
export const useDemoUi = () => useContext(UiContext)

const floor2 = (n: number) => Math.floor(n * 100) / 100

export function DemoUiProvider({ children }: { children: ReactNode }) {
  const [kind, setKind] = useState<Kind | null>(null)
  const [msg, setMsg] = useState<Done | null>(null)
  const [lastBorrow, setLastBorrow] = useState<number | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const toast = (t: string | Done) => {
    const d = typeof t === 'string' ? { text: t } : t
    setMsg(d)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMsg(null), d.hash ? 9000 : 4000)
  }
  return (
    <UiContext.Provider value={{ open: setKind, toast, lastBorrow }}>
      {children}
      {kind && <ActionModal kind={kind} onClose={() => setKind(null)} onDone={(d, a) => { if (kind === 'borrow') setLastBorrow(a); toast(d) }} />}
      {msg && (
        <div className="toast" role="status">
          {msg.text}
          {msg.hash && <> · <a href={lienTx(msg.hash)} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>proof on stellar.expert ↗</a></>}
        </div>
      )}
    </UiContext.Provider>
  )
}

function ActionModal({ kind, onClose, onDone }: { kind: Kind; onClose: () => void; onDone: (t: Done, amount: number) => void }) {
  const s = useDemo()
  const A = ACTS[kind]
  const max = floor2(actions.max(kind, s))
  const [amount, setAmount] = useState(String(Math.min(A.def, max)))
  const [err, setErr] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const a = Number(amount) || 0
  const ok = a > 0 && a <= max && !sending

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !sending && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, sending])

  async function confirm() {
    setErr(null)
    setSending(true)
    try {
      const done = await actions.run(kind, a)
      onClose()
      onDone(done, a)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  const debtAfter = A.debt ? A.debt(s.debt, a) : s.debt
  const sharesAfter = A.shares ? A.shares(s.shares, a) : s.shares
  const showPreview = (A.debt || A.shares) && sharesAfter > 0
  const fmt = (n: number) => (A.unit === 'USDC' ? usdc(n) : `${n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} AAPL`)

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && !sending && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={A.title}>
        <div className="head"><h2>{A.title}</h2><button className="round" onClick={onClose} disabled={sending} aria-label="Close"><X className="i" aria-hidden /></button></div>
        <div>
          <small className="muted">{A.label}</small>
          <div className="amount">
            <input type="number" min={0} max={max} step={A.step} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus aria-label={A.label} />
            <span className="muted">{A.unit}</span>
          </div>
          <small className="muted">Maximum: {fmt(max)} <button className="link" style={{ textDecoration: 'underline' }} onClick={() => setAmount(String(max))}>max</button></small>
        </div>
        {showPreview && (
          <div className="pos" style={{ padding: 14 }}>
            <Gauge ltv={s.price ? debtAfter / (sharesAfter * s.price) : 0} />
            <small className="muted">after this</small>
          </div>
        )}
        {err && <p role="alert" className="small s-danger">{err}</p>}
        <button className="btn primary" disabled={!ok} onClick={confirm} style={{ justifyContent: 'center', padding: 12 }}>
          {sending ? 'Signing and sending…' : chainReady ? 'Confirm in Freighter' : 'Confirm (simulation)'}<Term>sign transaction</Term>
        </button>
        <small className="muted">
          {chainReady ? 'Freighter opens to sign. The transaction is sent to Stellar testnet (fee ≈ 0.0001 XLM).' : 'Demo: no wallet is connected and nothing is sent to Stellar.'}
        </small>
      </div>
    </div>
  )
}
