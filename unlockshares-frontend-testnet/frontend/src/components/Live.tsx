import { useEffect, useMemo, useState } from 'react'
import { usd } from './demo'

const AN = 365 * 24 * 3600

/** Secondes écoulées depuis l'ouverture du composant, rafraîchies 10 fois par seconde. */
function useSecondes() {
  const [t0] = useState(() => Date.now())
  const [now, setNow] = useState(t0)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(id)
  }, [])
  return (now - t0) / 1000
}

const fin = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 7, maximumFractionDigits: 7 })}`

/** Compteur en direct (inspiré d'Aave) : intérêts gagnés ou dus depuis l'arrivée sur la page, à la seconde. */
export function LiveInterest({ lent, lendRate, debt, borrowRate }: { lent: number; lendRate: number; debt: number; borrowRate: number }) {
  const sec = useSecondes()
  if (!lent && !debt) return null
  const gagne = (lent * lendRate * sec) / AN
  const du = (debt * borrowRate * sec) / AN
  return (
    <div className="live">
      {lent > 0 && (
        <div className="line"><span className="muted"><i className="live-dot" aria-hidden />Earned since you opened this page</span><span className="num s-safe">+{fin(gagne)}</span></div>
      )}
      {debt > 0 && (
        <div className="line"><span className="muted"><i className="live-dot cost" aria-hidden />Loan interest since you opened this page</span><span className="num">{fin(du)}</span></div>
      )}
    </div>
  )
}

const ANS = [1, 2, 3, 5] as const

/** Simulateur « Futur » : garder ses actions et emprunter, plutôt que les vendre. Simulation, pas un conseil. */
export function FutureSim({ shares, price, debt, borrowRate }: { shares: number; price: number; debt: number; borrowRate: number }) {
  const [nb, setNb] = useState(String(shares > 0 ? shares : 10))
  const [pret, setPret] = useState(String(debt > 0 ? Math.round(debt) : 1000))
  const [hausse, setHausse] = useState('8')
  const [ans, setAns] = useState<(typeof ANS)[number]>(3)
  const n = Math.max(0, Number(nb) || 0)
  const L = Math.max(0, Number(pret) || 0)
  const g = (Number(hausse) || 0) / 100

  const points = useMemo(() => {
    const out: { an: number; garde: number; cout: number }[] = []
    for (let a = 1; a <= ans; a++) {
      out.push({ an: a, garde: n * price * ((1 + g) ** a - 1), cout: L * ((1 + borrowRate) ** a - 1) })
    }
    return out
  }, [n, price, g, L, borrowRate, ans])

  const der = points[points.length - 1] ?? { garde: 0, cout: 0 }
  const net = der.garde - der.cout
  const max = Math.max(1, ...points.map((p) => Math.max(Math.abs(p.garde), p.cout)))
  const champ = { font: 'inherit', width: '100%', minWidth: 0, padding: '6px 8px', border: '1px solid var(--line)', borderRadius: 8, background: 'transparent', color: 'var(--ink)' }

  if (!(price > 0)) return <div className="empty"><span className="muted">Loading the Apple price…</span></div>

  return (
    <section className="future" aria-label="Keep or sell simulator">
      <div className="future-res">
        <small className="muted">Keep your shares instead of selling them · in {ans} {ans > 1 ? 'years' : 'year'}</small>
        <div className={`big ${net >= 0 ? '' : 's-danger'}`}>{net >= 0 ? '+' : '−'}{usd(Math.abs(net))}</div>
        <small className="muted">
          <span className="fut-key up" /> Rise you keep {usd(der.garde)} · <span className="fut-key cost" /> Loan cost {usd(der.cout)}
        </small>
        <div className="fut-bars" role="img" aria-label={`Year by year: rise kept versus loan cost over ${ans} years`}>
          {points.map((p) => (
            <div key={p.an} className="fut-col">
              <div className="fut-pair">
                <i className="up" style={{ height: `${(Math.max(0, p.garde) / max) * 100}%` }} />
                <i className="cost" style={{ height: `${(p.cout / max) * 100}%` }} />
              </div>
              <small className="muted">Y{p.an}</small>
            </div>
          ))}
        </div>
        <div className="chips">
          {ANS.map((a) => (
            <button key={a} className={`round ${a === ans ? 'on' : ''}`} onClick={() => setAns(a)} aria-pressed={a === ans}>{a}Y</button>
          ))}
        </div>
      </div>
      <div className="future-in">
        <label><small className="muted">Apple shares you keep</small><input type="number" min={0} step={1} value={nb} onChange={(e) => setNb(e.target.value)} style={champ} /></label>
        <label><small className="muted">Cash you borrow ($)</small><input type="number" min={0} step={50} value={pret} onChange={(e) => setPret(e.target.value)} style={champ} /></label>
        <label><small className="muted">Apple rise per year (%)</small><input type="number" step={1} value={hausse} onChange={(e) => setHausse(e.target.value)} style={champ} /></label>
        <small className="muted">Today: 1 Apple share = {usd(price)}, loan rate {(borrowRate * 100).toFixed(1)} % a year.</small>
        <small className="muted">Simulation only, not advice. Apple can also fall: below the protection price, part of your shares is sold.</small>
      </div>
    </section>
  )
}
