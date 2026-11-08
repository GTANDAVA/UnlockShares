import { Banknote, Check, CircleAlert, History, KeyRound, Landmark, LoaderCircle, Lock, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useConnect } from '../components/Onboarding'
import { useDemo } from '../lib/useDemo'
import '../styles/cashout.css'

// Off-ramp SIMULÉ : imite fidèlement un retrait SEP-24 (connexion SEP-10, fenêtre de l'anchor, statuts),
// sans aucune transaction ni appel réseau. Analogie : une répétition générale avec de faux billets.

const RATE = 0.92 // 1 USDC = 0,92 € (taux fixe de démo)
const FEE = 0.01 // frais de l'anchor : 1 % (démo)
const KEY = 'unlockshares.cashouts'

const STEPS = [
  { icon: Banknote, title: 'Choose the amount', sub: 'tUSDC → EUR' },
  { icon: KeyRound, title: 'Sign in to the anchor', sub: 'SEP-10 · wallet challenge' },
  { icon: Landmark, title: 'Bank details', sub: 'SEP-24 · anchor’s window' },
  { icon: Check, title: 'Money on its way', sub: 'Anchor pays your bank' },
]

const FLOW = [
  { st: 'pending_user_transfer_start', label: 'Waiting for your tUSDC', sub: 'Funds sent to the anchor (simulated)' },
  { st: 'pending_anchor', label: 'Anchor is processing', sub: 'Conversion USDC → EUR' },
  { st: 'pending_external', label: 'Bank transfer sent', sub: 'SEPA transfer in progress' },
  { st: 'completed', label: '€ sent to your bank', sub: 'Withdrawal completed' },
]

const AUTH = ['Requesting a challenge from the anchor…', 'Challenge signed by your wallet (simulated)', 'Session token received']

type Payout = { ref: string; date: string; amount: number; eur: number; fee: number; name: string; iban: string }

const readHistory = (): Payout[] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
const saveHistory = (h: Payout[]) => {
  try { localStorage.setItem(KEY, JSON.stringify(h.slice(0, 20))) } catch { /* stockage indisponible : l'historique reste en mémoire */ }
}

const euro = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
const num = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })
const cleanIban = (v: string) => v.replace(/\s+/g, '').toUpperCase()
const ibanOk = (v: string) => /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(cleanIban(v))
const maskIban = (v: string) => `${v.slice(0, 4)} •••• ${v.slice(-4)}`
const newRef = () => `DEMO-SEPA-${Math.random().toString(36).slice(2, 8).toUpperCase()}`

type Phase = 'amount' | 'auth' | 'form' | 'track'

export function CashOutPage() {
  const s = useDemo()
  const connect = useConnect()
  const balance = Math.floor(s.usdc * 100) / 100
  const needWallet = s.mode === 'chain' && !s.address

  const [phase, setPhase] = useState<Phase>('amount')
  const [amount, setAmount] = useState('')
  const [auth, setAuth] = useState(0)
  const [name, setName] = useState('')
  const [iban, setIban] = useState('')
  const [kyc, setKyc] = useState(false)
  const [touched, setTouched] = useState(false)
  const [flow, setFlow] = useState(0)
  const [current, setCurrent] = useState<Payout | null>(null)
  const [history, setHistory] = useState<Payout[]>(readHistory)

  const a = Number(amount.replace(',', '.')) || 0
  const fee = Math.round(a * FEE * 100) / 100
  const eur = Math.round((a - fee) * RATE * 100) / 100
  const amountOk = a > 0 && a <= balance
  const formOk = name.trim().length >= 2 && ibanOk(iban) && kyc

  // Connexion SEP-10 simulée : trois petites étapes animées
  useEffect(() => {
    if (phase !== 'auth') return
    if (auth >= AUTH.length) { const t = window.setTimeout(() => setPhase('form'), 600); return () => window.clearTimeout(t) }
    const t = window.setTimeout(() => setAuth((x) => x + 1), 900)
    return () => window.clearTimeout(t)
  }, [phase, auth])

  // Statuts SEP-24 simulés, l'un après l'autre
  useEffect(() => {
    if (phase !== 'track' || flow >= FLOW.length - 1) return
    const t = window.setTimeout(() => setFlow((x) => x + 1), 2200)
    return () => window.clearTimeout(t)
  }, [phase, flow])

  // Retrait terminé → historique local
  useEffect(() => {
    if (phase !== 'track' || flow !== FLOW.length - 1 || !current) return
    setHistory((h) => {
      if (h.some((p) => p.ref === current.ref)) return h
      const next = [current, ...h]
      saveHistory(next)
      return next
    })
  }, [phase, flow, current])

  const step = phase === 'amount' ? 0 : phase === 'auth' ? 1 : phase === 'form' ? 2 : flow === FLOW.length - 1 ? 4 : 3

  const signIn = () => { setAuth(0); setPhase('auth') }
  const confirm = () => {
    setTouched(true)
    if (!formOk) return
    setCurrent({ ref: newRef(), date: new Date().toISOString(), amount: a, eur, fee, name: name.trim(), iban: cleanIban(iban) })
    setFlow(0)
    setPhase('track')
  }
  const restart = () => { setPhase('amount'); setAmount(''); setKyc(false); setTouched(false); setCurrent(null); setFlow(0) }
  const clearHistory = () => { setHistory([]); saveHistory([]) }

  return (
    <div className="co">
      <div className="co-banner" role="note">
        <CircleAlert className="v-ic" aria-hidden />
        <span><b>Demo simulation — no real money moves.</b> In production this step uses a licensed Stellar anchor (SEP-24), e.g. MoneyGram.</span>
      </div>

      <div className="head">
        <div>
          <h1>Cash out</h1>
          <p className="muted">Turn your borrowed tUSDC into euros on your bank account, through a Stellar anchor.</p>
        </div>
        <div className="kpis">
          <div className="kpi"><small>tUSDC in wallet{s.mode === 'demo' ? ' (demo)' : ''}</small><b>{num(balance)}</b></div>
          <div className="kpi"><small>Demo rate</small><b>1 USDC = 0,92 €</b></div>
        </div>
      </div>

      <ol className="co-steps">
        {STEPS.map((st, i) => {
          const state = i < step ? 'done' : i === step ? 'now' : ''
          const Ic = state === 'done' ? Check : st.icon
          const spinning = state === 'now' && (phase === 'auth' || phase === 'track')
          return (
            <li key={st.title} className={state}>
              <span className="co-dot">{spinning ? <LoaderCircle className="spin" /> : <Ic />}</span>
              <div><b>{st.title}</b><small>{st.sub}</small></div>
            </li>
          )
        })}
      </ol>

      {needWallet ? (
        <div className="empty"><b>Connect your wallet</b><span className="muted">We read your real tUSDC balance from Varial. Nothing is sent.</span><button className="btn primary" onClick={() => void connect()}>Connect Varial</button></div>
      ) : phase === 'amount' ? (
        <div className="co-card">
          <label className="co-label" htmlFor="co-amount">Amount to cash out</label>
          <div className="co-amount">
            <input id="co-amount" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={a > balance} />
            <span>tUSDC</span>
            <button className="btn" onClick={() => setAmount(String(balance))} disabled={!balance}>Max</button>
          </div>
          <small className="muted">Max {num(balance)} tUSDC · your wallet balance{s.mode === 'chain' ? ' read on Stellar testnet' : ''}</small>
          {a > balance && <p className="co-err"><TriangleAlert className="v-ic" />More than your balance.</p>}

          <div className="co-kv">
            <span>Currency</span><b>EUR · bank transfer (SEPA)</b>
            <span>Rate (demo)</span><b>1 USDC = 0,92 €</b>
            <span>Anchor fee (demo, 1 %)</span><b>{num(fee)} tUSDC</b>
            <span>You receive</span><b className="co-big">{euro(Math.max(eur, 0))}</b>
          </div>

          <div className="chips">
            <button className="btn primary" onClick={signIn} disabled={!amountOk}><KeyRound className="i" />Sign in to the anchor</button>
          </div>
          {!balance && <small className="muted">No tUSDC yet: borrow first on the Borrow page.</small>}
        </div>
      ) : phase === 'auth' ? (
        <div className="co-card">
          <b>Signing in to the anchor <span className="tag">SEP-10</span></b>
          <span className="muted">The anchor checks that you own this wallet, like showing your ID at the exchange desk.</span>
          <ul className="co-auth">
            {AUTH.map((t, i) => (
              <li key={t} className={i < auth ? 'done' : i === auth ? 'now' : ''}>
                {i < auth ? <Check className="v-ic" /> : i === auth ? <LoaderCircle className="v-ic spin" /> : <span className="co-pip" />}{t}
              </li>
            ))}
          </ul>
        </div>
      ) : phase === 'form' ? (
        <div className="co-anchor" role="dialog" aria-label="Anchor withdrawal form">
          <div className="co-bar"><Lock className="v-ic" aria-hidden /><span>demo-anchor.example / sep24 / withdraw</span><span className="tag">Demo</span></div>
          <div className="co-anchor-body">
            <div className="co-anchor-head">
              <span className="co-logo"><Landmark /></span>
              <div><b>Demo Anchor</b><small>Interactive withdrawal · SEP-24</small></div>
            </div>
            <div className="co-sum">
              <span>You send <b>{num(a)} tUSDC</b></span>
              <span>You receive <b>{euro(eur)}</b></span>
            </div>
            <label className="co-field">
              <span>Account holder name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Léa Martin" autoComplete="off" />
              {touched && name.trim().length < 2 && <small className="co-err">Enter the account holder’s name.</small>}
            </label>
            <label className="co-field">
              <span>IBAN</span>
              <input value={iban} onChange={(e) => setIban(e.target.value)} placeholder="FR76 3000 6000 0112 3456 7890 189" autoComplete="off" spellCheck={false} />
              {touched && !ibanOk(iban) && <small className="co-err">Invalid IBAN format (2 letters, 2 digits, then 11 to 30 characters).</small>}
            </label>
            <label className="co-check">
              <input type="checkbox" checked={kyc} onChange={(e) => setKyc(e.target.checked)} />
              <span><ShieldCheck className="v-ic" aria-hidden /> I confirm my identity (demo)</span>
            </label>
            {touched && !kyc && <small className="co-err">Identity check (KYC) is required by the anchor.</small>}
            <div className="chips">
              <button className="btn primary" onClick={confirm}>Confirm withdrawal</button>
              <button className="btn" onClick={restart}>Cancel</button>
            </div>
            <small className="muted">Fake details are fine: this window imitates the anchor’s own page.</small>
          </div>
        </div>
      ) : (
        <div className="co-card">
          <b>Withdrawal {current?.ref} <span className="tag">Demo</span></b>
          <ol className="co-flow">
            {FLOW.map((f, i) => {
              const state = i < flow || flow === FLOW.length - 1 ? 'done' : i === flow ? 'now' : ''
              return (
                <li key={f.st} className={state}>
                  <span className="co-dot">{state === 'done' ? <Check /> : state === 'now' ? <LoaderCircle className="spin" /> : <span className="co-pip" />}</span>
                  <div><b>{f.label}</b><small><code>{f.st}</code> · {f.sub}</small></div>
                </li>
              )
            })}
          </ol>
          {flow === FLOW.length - 1 && current && (
            <>
              <p className="co-ok"><Check className="v-ic" />{euro(current.eur)} sent to {current.name} · {maskIban(current.iban)}</p>
              <div className="co-kv">
                <span>Transfer reference</span><code>{current.ref} (demo, not a real transfer)</code>
                <span>Sent</span><b>{num(current.amount)} tUSDC</b>
                <span>Anchor fee</span><b>{num(current.fee)} tUSDC</b>
              </div>
              <div className="chips"><button className="btn primary" onClick={restart}>New cash out</button><a className="btn" href="#emprunter">Back to Borrow</a></div>
            </>
          )}
        </div>
      )}

      <div className="co-card">
        <div className="co-row"><b><History className="v-ic" /> Simulated withdrawals</b>{history.length > 0 && <button className="btn" onClick={clearHistory}>Clear</button>}</div>
        {history.length === 0 ? (
          <span className="muted">None yet. They are kept in this browser only.</span>
        ) : (
          <ul className="co-hist">
            {history.map((p) => (
              <li key={p.ref}>
                <div><b>{euro(p.eur)}</b><small>{num(p.amount)} tUSDC · {new Date(p.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</small></div>
                <div className="co-hist-r"><code>{p.ref}</code><small>{maskIban(p.iban)} · completed</small></div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
