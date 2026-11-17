// Page « Discover » v2 : présentation façon aave.com/app, adaptée à UnlockShares.
// Retours de Greg (17/11/2026) : plus fluide, moins de texte, plus d'air, plus d'envie.
// Donc : une idée par écran, de grands chiffres, des pastilles qui flottent, des compteurs qui s'animent,
// des sections qui apparaissent au défilement. Chiffres « live » = contrat testnet ; le reste = règles du contrat.
import { ArrowDownToLine, Banknote, ChevronDown, Fingerprint, HandCoins, KeyRound, Percent, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { TokenLogo } from '../components/logos'
import { useDemo } from '../lib/useDemo'
import { DEMO } from '../services/mockDemo'

const pct = (x: number) => `${(x * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const calme = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function useLive() {
  const s = useDemo()
  const demo = s.mode === 'demo'
  const ok = demo || (s.loaded && !s.error)
  return {
    ok, demo,
    borrow: demo ? DEMO.borrowRate : s.market.borrowRate,
    lend: demo ? DEMO.lendRate : s.market.lendRate,
    lent: demo ? 1_200_000 : s.market.totalLent,
    borrowed: demo ? 912_000 : s.market.totalBorrowed,
    price: s.market.refPrice ?? s.price,
  }
}

/** Apparition douce quand la section entre à l'écran */
function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [vu, setVu] = useState(calme)
  useEffect(() => {
    const el = ref.current
    if (!el || vu) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVu(true); io.disconnect() } }, { threshold: 0.15 })
    io.observe(el)
    return () => io.disconnect()
  }, [vu])
  return <div ref={ref} className={`d-rev ${vu ? 'in' : ''} ${className}`}>{children}</div>
}

/** Nombre qui glisse vers sa nouvelle valeur */
function useCount(cible: number, ms = 600) {
  const [v, setV] = useState(cible)
  const de = useRef(cible)
  useEffect(() => {
    const dur = calme() ? 0 : ms
    const a = de.current, t0 = performance.now()
    let id = 0
    const pas = (t: number) => {
      const k = dur ? Math.min(1, (t - t0) / dur) : 1, e = 1 - (1 - k) ** 3
      const x = a + (cible - a) * e
      setV(x); de.current = x
      if (k < 1) id = requestAnimationFrame(pas)
    }
    id = requestAnimationFrame(pas)
    return () => cancelAnimationFrame(id)
  }, [cible, ms])
  return v
}

function Hero() {
  const r = useLive()
  return (
    <section className="d-hero">
      <div className="d-float" aria-hidden>
        <span className="d-chip c1"><i className="d-logo"><TokenLogo kind="aapl" /></i>10 AAPL kept</span>
        <span className="d-chip c2 d-green">+ $1,250 cash</span>
        <span className="d-chip c3"><Fingerprint />Face ID</span>
        <span className="d-chip c4"><Banknote />Cash at MoneyGram</span>
        <span className="d-chip c5"><i className="d-logo"><TokenLogo kind="usdc" /></i>{r.ok ? `${pct(r.lend)} for lenders` : 'Earn on USDC'}</span>
        <span className="d-orb" />
      </div>
      <h1>Keep your shares.<br /><span className="v-hl">Get the cash.</span></h1>
      <p className="d-lead">Dollars against your stocks, in a minute.</p>
      <a className="btn primary d-big" href="#cash">Get cash</a>
    </section>
  )
}

function Play() {
  const r = useLive()
  const [n, setN] = useState(10)
  const prix = r.price > 0 ? r.price : 250
  const cash = useCount(n * prix * 0.5)
  const mois = (n * prix * 0.5 * r.borrow) / 12
  return (
    <section className="d-play">
      <Reveal>
        <p className="d-eyebrow">Try it</p>
        <h2>Slide your shares.</h2>
        <div className="d-shares" aria-hidden>
          {Array.from({ length: Math.min(n, 40) }, (_, i) => <i key={i} className="d-sh"><TokenLogo kind="aapl" /></i>)}
          {n > 40 && <span className="muted">+{n - 40}</span>}
        </div>
        <input className="d-range" type="range" min={1} max={100} value={n} onChange={(e) => setN(Number(e.target.value))} aria-label="Apple shares you own" />
        <p className="muted">{n} Apple {n > 1 ? 'shares' : 'share'} unlock</p>
        <div className="d-giant num">{money(cash)}</div>
        <p className="muted small">{r.ok && r.borrow > 0 ? `about ${money(mois)} a month at today's rate · ` : ''}simulation, testnet</p>
      </Reveal>
    </section>
  )
}

const TILES = [
  { href: '#cash', icon: HandCoins, title: 'Get cash', line: 'Lock shares, receive dollars.' },
  { href: '#preter', icon: Percent, title: 'Earn', line: 'Lend dollars, earn interest.' },
  { href: '#ajouter', icon: ArrowDownToLine, title: 'Add money', line: 'Bank or cash in.' },
  { href: '#retrait', icon: Banknote, title: 'Cash out', line: 'Pick it up at MoneyGram.' },
]

function Tiles() {
  return (
    <section>
      <Reveal>
        <h2 className="d-center">One app. Four moves.</h2>
        <div className="d-tiles">
          {TILES.map(({ href, icon: I, title, line }, i) => (
            <a key={title} href={href} className="d-tile" style={{ transitionDelay: `${i * 80}ms` }}>
              <span className="d-tic"><I /></span><b>{title}</b><span className="muted">{line}</span>
            </a>
          ))}
        </div>
      </Reveal>
    </section>
  )
}

function Cushion() {
  return (
    <section>
      <Reveal className="d-cushion">
        <p className="d-eyebrow">Peace of mind</p>
        <h2>Prices fall. You're cushioned.</h2>
        <div className="d-gauge" aria-label="Borrow up to 50%, cushion up to 80%">
          <span className="g1" /><span className="g2" /><span className="g3" />
          <i className="d-needle" />
        </div>
        <div className="d-glabels"><span>Borrow up to <b>50%</b></span><span>Partial sale only from <b>80%</b></span></div>
      </Reveal>
    </section>
  )
}

function Numbers() {
  const r = useLive()
  const a = useCount(r.ok ? r.lent : 0, 1200)
  const b = useCount(r.ok ? r.borrowed : 0, 1200)
  if (!r.ok) return null
  return (
    <section>
      <Reveal>
        <div className="d-nums">
          <div><b className="num">{money(a)}</b><span className="muted">lent</span></div>
          <div><b className="num">{money(b)}</b><span className="muted">borrowed</span></div>
          <div><b className="num">{pct(r.borrow)}</b><span className="muted">rate today</span></div>
        </div>
        <p className="muted small d-center">{r.demo ? 'Demo figures' : 'Live from Stellar testnet'}</p>
      </Reveal>
    </section>
  )
}

const TRUST = [
  { icon: Fingerprint, t: 'Face ID login' },
  { icon: KeyRound, t: 'Your keys, your shares' },
  { icon: ShieldCheck, t: 'Public contract' },
]

function Trust() {
  return (
    <section>
      <Reveal>
        <div className="d-trust">{TRUST.map(({ icon: I, t }) => <span key={t}><I />{t}</span>)}</div>
      </Reveal>
    </section>
  )
}

const FAQ: [string, string][] = [
  ['Do I lose my shares?', 'No. They are locked and come back when you repay.'],
  ['Is the rate fixed?', 'No. It follows pool usage, and you see it before you sign.'],
  ['What if the price falls?', 'Nothing until your loan hits 80%. Then only a part is sold.'],
  ['Is this real money?', 'Not yet: Stellar testnet, test tokens only. No external audit yet.'],
]

function Questions() {
  const [open, setOpen] = useState<number | null>(null)
  return (
    <section>
      <Reveal>
        <div className="p-faq d-faq">
          {FAQ.map(([q, a], j) => (
            <div key={q} className={`p-q ${open === j ? 'on' : ''}`}>
              <button aria-expanded={open === j} onClick={() => setOpen(open === j ? null : j)}>{q}<ChevronDown className="v-ic" /></button>
              {open === j && <p>{a}</p>}
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  )
}

export function DiscoverPage() {
  return (
    <div className="d">
      <Hero />
      <Play />
      <Tiles />
      <Cushion />
      <Numbers />
      <Trust />
      <Questions />
      <section className="d-final"><h2>Your shares can do more.</h2><a className="btn primary d-big" href="#cash">Get cash</a></section>
    </div>
  )
}
