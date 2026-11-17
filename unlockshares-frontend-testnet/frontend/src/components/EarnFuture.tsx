// Page Earn, inspirée de l'appli Aave (Greg, 17/11/2026) :
// 1. un grand solde prêteur qui grandit en direct (estimation au taux actuel, recalée sur la chaîne à chaque lecture),
// 2. un simulateur « Future » : versement ponctuel ou mensuel, barres année par année (versé / intérêts).
// Le taux prêteur n'est pas fixe : il dépend de l'utilisation du pool. Tout est affiché comme une simulation.
import { useEffect, useMemo, useState } from 'react'
import { useDemo } from '../lib/useDemo'
import { DEMO } from '../services/mockDemo'
import { Term, useDemoUi } from './demo'

const money = (n: number, d = 2) => `$${n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`
const pct = (x: number) => `${(x * 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`
const YEAR_S = 365 * 24 * 3600

/** Solde prêteur estimé à la seconde, à partir de la dernière lecture et du taux actuel */
function useLiveBalance(base: number, rate: number) {
  const [t0, setT0] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { setT0(Date.now()) }, [base, rate])
  useEffect(() => {
    if (!base || !rate) return
    const id = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(id)
  }, [base, rate])
  const secs = Math.max(0, (now - t0) / 1000)
  return base * (1 + (rate * secs) / YEAR_S)
}

export function EarnHero() {
  const s = useDemo()
  const { open } = useDemoUi()
  const demo = s.mode === 'demo'
  const rate = demo ? DEMO.lendRate : s.market.lendRate
  const live = useLiveBalance(s.lent, rate)
  const perWeek = (s.lent * rate) / 52
  return (
    <section className="earn-hero" aria-label="Your savings">
      <small className="muted">{s.lent ? 'Earning' : 'Start earning'} {pct(rate)} a year<Term>lend APY, variable</Term></small>
      <div className="earn-big num" aria-live="off">{s.lent ? money(live, 6) : money(0)}</div>
      {s.lent
        ? <p className="earn-gain"><i aria-hidden />+{money(perWeek, 4)} a week at today's rate</p>
        : <p className="muted">Lend USDC to the pool and watch it grow every second.</p>}
      <div className="earn-actions">
        <button className="btn" onClick={() => open('withdrawLend')} disabled={!s.lent}>Withdraw</button>
        <button className="btn primary" onClick={() => open('lend')} disabled={!s.usdc}>Add</button>
      </div>
      <p className="muted small">Live estimate between two readings of the contract (every 10 s). The rate moves with how much of the pool is borrowed.</p>
    </section>
  )
}

type Mode = 'once' | 'monthly'
const YEARS = [1, 5, 10, 30]

/** Projection année par année, intérêts composés chaque mois */
function project(amount: number, mode: Mode, years: number, rate: number) {
  const r = rate / 12
  let bal = 0, paid = 0
  const out: { paid: number; total: number }[] = []
  for (let m = 1; m <= years * 12; m++) {
    if (mode === 'monthly' || m === 1) { bal += amount; paid += amount }
    bal *= 1 + r
    if (m % 12 === 0) out.push({ paid, total: bal })
  }
  return out
}

export function EarnFuture() {
  const s = useDemo()
  const demo = s.mode === 'demo'
  const today = demo ? DEMO.lendRate : s.market.lendRate
  // Taux prêteur quand le pool est emprunté à 80 % (coude de la courbe) : 6 % × 80 % × 90 % = 4,32 %
  const busy = 0.06 * 0.8 * 0.9
  const [which, setWhich] = useState<'today' | 'busy'>('today')
  const rate = which === 'today' ? today : busy
  const [amount, setAmount] = useState(100)
  const [mode, setMode] = useState<Mode>('monthly')
  const [years, setYears] = useState(5)
  const rows = useMemo(() => project(amount, mode, years, rate), [amount, mode, years, rate])
  const last = rows[rows.length - 1] ?? { paid: 0, total: 0 }
  const max = Math.max(1, last.total)
  const step = years > 10 ? 5 : years > 5 ? 2 : 1
  return (
    <section className="earn-future" aria-label="Simulate the future">
      <div className="head">
        <div><h2>Simulate the future</h2><p className="muted">What your savings could become, at today's rate or when the pool is busy.</p></div>
        <span className="pill ef-sim">Simulation</span>
      </div>
      <div className="ef-controls">
        <label className="ef-amount"><span className="muted small">Amount</span>
          <span className="ef-input">$<input type="number" inputMode="decimal" min={0} value={amount} onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))} /></span>
        </label>
        <div className="seg" role="group" aria-label="How often">
          <button className={mode === 'once' ? 'on' : ''} onClick={() => setMode('once')}>One-time</button>
          <button className={mode === 'monthly' ? 'on' : ''} onClick={() => setMode('monthly')}>Every month</button>
        </div>
        <div className="seg" role="group" aria-label="How long">
          {YEARS.map((y) => <button key={y} className={years === y ? 'on' : ''} onClick={() => setYears(y)}>{y}Y</button>)}
        </div>
        <div className="seg" role="group" aria-label="Rate to simulate">
          <button className={which === 'today' ? 'on' : ''} onClick={() => setWhich('today')}>Today {pct(today)}</button>
          <button className={which === 'busy' ? 'on' : ''} onClick={() => setWhich('busy')} title="Lender rate when 80 % of the pool is borrowed">Busy pool {pct(busy)}</button>
        </div>
      </div>
      <div className="ef-result">
        <div><small className="muted">In {years} {years > 1 ? 'years' : 'year'}</small><b className="num">{money(last.total)}</b></div>
        <div><small className="muted">You put in</small><span className="num">{money(last.paid)}</span></div>
        <div><small className="muted">Interest earned</small><span className="num ef-green">+{money(last.total - last.paid)}</span></div>
      </div>
      <div className="ef-chart" role="img" aria-label={`Projection over ${years} years: ${money(last.total)}, of which ${money(last.total - last.paid)} interest`}>
        {rows.map((r, i) => (
          <div className="ef-col" key={i} title={`Year ${i + 1}: ${money(r.total)} (interest ${money(r.total - r.paid)})`}>
            <div className="ef-bar" style={{ height: `${(r.total / max) * 100}%` }}>
              <span className="ef-int" style={{ flexGrow: Math.max(0, r.total - r.paid) }} />
              <span className="ef-paid" style={{ flexGrow: r.paid }} />
            </div>
            <small className="muted">{(i + 1) % step === 0 || i === 0 ? `${i + 1}Y` : ''}</small>
          </div>
        ))}
      </div>
      <div className="ef-legend small"><span><i className="ef-paid" />You put in</span><span><i className="ef-int" />Interest</span></div>
      <p className="muted small">Simulation at {pct(rate)} a year ({which === 'today' ? "today's lend rate" : 'lend rate when 80 % of the pool is borrowed'}), interest added every month. The real rate changes with pool usage and is not guaranteed. Not financial advice.</p>
    </section>
  )
}
