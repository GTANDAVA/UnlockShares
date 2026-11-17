// Page « Discover » v3 (Greg, 17/11/2026) : tout est déjà dans la vidéo de l'onglet Presentation,
// cette page l'illustre de façon ludique, propre, aérée et simple. Même histoire (Léa), mêmes chiffres,
// un chapitre par écran, et chaque chapitre se « joue » (clic ou curseur) au lieu d'être lu.
import { Banknote, Briefcase, Car, Lock, LockOpen, ShieldCheck, TriangleAlert, TrendingUp, ArrowDown } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { TokenLogo } from '../components/logos'

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const calme = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Apparition douce quand la section entre à l'écran */
function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [vu, setVu] = useState(calme)
  useEffect(() => {
    const el = ref.current
    if (!el || vu) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVu(true); io.disconnect() } }, { threshold: 0.2 })
    io.observe(el)
    return () => io.disconnect()
  }, [vu])
  return <div ref={ref} className={`d-rev ${vu ? 'in' : ''} ${className}`}>{children}</div>
}

/** Nombre qui glisse vers sa nouvelle valeur */
function useCount(cible: number, ms = 700) {
  const [v, setV] = useState(cible)
  const de = useRef(cible)
  useEffect(() => {
    const dur = calme() ? 0 : ms
    const a = de.current, t0 = performance.now()
    let id = 0
    const pas = (t: number) => {
      const k = dur ? Math.min(1, (t - t0) / dur) : 1
      const x = a + (cible - a) * (1 - (1 - k) ** 3)
      setV(x); de.current = x
      if (k < 1) id = requestAnimationFrame(pas)
    }
    id = requestAnimationFrame(pas)
    return () => cancelAnimationFrame(id)
  }, [cible, ms])
  return v
}

const Apple = ({ cls = '', style }: { cls?: string; style?: React.CSSProperties }) => <i className={`d-sh ${cls}`} style={style}><TokenLogo kind="aapl" /></i>

function Chapter({ n, title, children }: { n: string; title: ReactNode; children: ReactNode }) {
  return (
    <section className="d-ch">
      <Reveal>
        <p className="d-eyebrow">{n}</p>
        <h2>{title}</h2>
        <div className="d-stage">{children}</div>
      </Reveal>
    </section>
  )
}

function Hero() {
  return (
    <section className="d-hero">
      <div className="d-float" aria-hidden>
        <span className="d-chip c1"><i className="d-logo"><TokenLogo kind="aapl" /></i>10 shares, still hers</span>
        <span className="d-chip c2 d-green">+ $400 cash</span>
        <span className="d-chip c3"><Lock />Locked, not sold</span>
        <span className="d-chip c4">Repay anytime</span>
        <span className="d-chip c5">Built on Stellar</span>
        <span className="d-orb" />
      </div>
      <h1>Keep your shares.<br /><span className="v-hl">Get the cash.</span></h1>
      <p className="d-lead">Meet Léa. Scroll her story.</p>
      <span className="d-scroll" aria-hidden><ArrowDown /></span>
    </section>
  )
}

/** Intro : 10 actions, portefeuille vide */
function Intro() {
  return (
    <Chapter n="Léa" title={<>She owns <span className="v-hl">$1,000</span> of Apple.<br />Her wallet: <span className="d-red">$0</span>.</>}>
      <div className="d-row10">{Array.from({ length: 10 }, (_, i) => <Apple key={i} style={{ animationDelay: `${i * 70}ms` }} />)}</div>
      <p className="muted">Shares are worth money. You just can't pay with them.</p>
    </Chapter>
  )
}

const BESOINS = [
  { icon: Briefcase, t: 'Cash advance', m: 3000 },
  { icon: Car, t: 'Emergency', m: 400 },
  { icon: TrendingUp, t: 'Investment', m: 5000 },
  { icon: Banknote, t: 'Off-ramp', m: 900 },
]

/** 1. Le besoin : on choisit une carte */
function Need() {
  const [on, setOn] = useState(1)
  return (
    <Chapter n="01 · The need" title="When do you need cash, fast?">
      <div className="d-needs">
        {BESOINS.map(({ icon: I, t, m }, i) => (
          <button key={t} className={`d-need ${on === i ? 'on' : ''}`} onClick={() => setOn(i)}>
            <I /><b>{t}</b><span>{usd(m)}</span>
          </button>
        ))}
      </div>
      <p className="muted">Sell your shares for this? There's a better way.</p>
    </Chapter>
  )
}

/** 2. La solution : un clic verrouille, l'argent arrive */
function Solution() {
  const [lock, setLock] = useState(false)
  const cash = useCount(lock ? 400 : 0, 900)
  return (
    <Chapter n="02 · The solution" title="Lock your shares. Borrow against them.">
      <div className="d-lane">
        <div className={`d-heap ${lock ? 'gone' : ''}`}>{Array.from({ length: 10 }, (_, i) => <Apple key={i} style={{ transitionDelay: `${i * 40}ms` }} />)}</div>
        <button className={`d-vault ${lock ? 'shut' : ''}`} onClick={() => setLock(!lock)} aria-pressed={lock}>
          {lock ? <Lock /> : <LockOpen />}<small>{lock ? '10 AAPL locked' : 'Tap to lock'}</small>
        </button>
        <div className="d-wallet"><small className="muted">Léa's wallet</small><b className="num">{usd(cash)}</b></div>
      </div>
      <div className="d-pills"><span>Up to 50% of their value</span><span>In 5 seconds</span><span>24/7, no banker</span></div>
    </Chapter>
  )
}

/** 3. Vendre ou emprunter : deux boutons */
function Versus() {
  const [choix, setChoix] = useState<'sell' | 'borrow' | null>(null)
  return (
    <Chapter n="03 · Why not just sell?" title="She needs $400. Sell or borrow?">
      <div className="d-seg">
        <button className={choix === 'sell' ? 'on ko' : ''} onClick={() => setChoix('sell')}>Sell 4 shares</button>
        <button className={choix === 'borrow' ? 'on ok' : ''} onClick={() => setChoix('borrow')}>Borrow $400</button>
      </div>
      <div className="d-row10 d-vs">
        {Array.from({ length: 10 }, (_, i) => (
          <Apple key={i} cls={choix === 'sell' && i < 4 ? 'fly' : choix === 'borrow' ? 'locked' : ''} style={{ transitionDelay: `${i * 30}ms` }} />
        ))}
      </div>
      <div className="d-verdict">
        {choix === 'sell' && <span className="d-stamp ko">Sold · upside gone</span>}
        {choix === 'borrow' && <span className="d-stamp ok">Still yours · 100% of the upside</span>}
        {!choix && <span className="muted">Pick one.</span>}
      </div>
    </Chapter>
  )
}

const PAIEMENTS = [
  { q: 'Month 1', a: 'pays $50', reste: 350 },
  { q: 'Month 3', a: 'pays $0', reste: 350 },
  { q: 'Month 7', a: 'pays $200', reste: 150 },
  { q: 'Whenever', a: 'repays the rest', reste: 0 },
]

/** 4. Remboursement libre : on avance mois par mois */
function Flex() {
  const [i, setI] = useState(-1)
  const dette = useCount(i < 0 ? 400 : PAIEMENTS[i].reste)
  return (
    <Chapter n="04 · Flexible repayment" title="Pay back when you want, what you want.">
      <div className="d-debt">
        <div className="d-debtline"><small className="muted">Debt</small><b className="num">{usd(dette)}</b></div>
        <div className="d-track"><span style={{ width: `${(dette / 400) * 100}%` }} /></div>
      </div>
      <div className="d-steps">
        {PAIEMENTS.map((p, j) => (
          <button key={p.q} className={j <= i ? 'on' : ''} onClick={() => setI(j)}><b>{p.q}</b><span>{p.a}</span></button>
        ))}
      </div>
      <p className="muted">{i === 3 ? 'Shares unlocked: back in her wallet.' : 'No schedule, no penalty. Tap the months.'}</p>
    </Chapter>
  )
}

/** 5. Un an plus tard */
function OneYear() {
  const [vu, setVu] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVu(true); io.disconnect() } }, { threshold: 0.5 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  const prix = useCount(vu ? 120 : 100, 1400)
  const sold = useCount(vu ? 720 : 0, 1600)
  const kept = useCount(vu ? 785 : 0, 1600)
  return (
    <Chapter n="05 · One year later" title={<>Apple goes from $100 to <span className="d-green">{usd(prix)}</span>.</>}>
      <div className="d-bars" ref={ref}>
        <div><span className="muted">If she had sold</span><div className="d-hb"><i style={{ width: `${(sold / 785) * 100}%` }} /></div><b className="num">{usd(sold)}</b></div>
        <div><span>She borrowed</span><div className="d-hb win"><i style={{ width: `${(kept / 785) * 100}%` }} /></div><b className="num">{usd(kept)}</b></div>
      </div>
      <span className={`d-stamp ok ${vu ? '' : 'hide'}`}>+$65, and all 10 shares are still hers</span>
    </Chapter>
  )
}

/** 6. Et si l'action chute : on fait glisser le prix */
function Fall() {
  const [prix, setPrix] = useState(100)
  const ltv = 415 / (10 * prix)
  const zone = ltv <= 0.5 ? 'safe' : ltv < 0.8 ? 'watch' : 'danger'
  const msg = {
    safe: { icon: ShieldCheck, t: 'Big cushion. Nothing happens.' },
    watch: { icon: TriangleAlert, t: 'Watch zone. She can repay a little, anytime.' },
    danger: { icon: ArrowDown, t: 'Protection sale: only part of her shares, back to 60%.' },
  }[zone]
  const M = msg.icon
  return (
    <Chapter n="06 · What if the share falls?" title="A safety net, in three zones.">
      <div className="d-fall">
        <div className="d-price"><small className="muted">Apple</small><b className={`num ${prix < 100 ? 'd-red' : ''}`}>{usd(prix)}</b></div>
        <input className="d-range" type="range" min={40} max={100} value={prix} onChange={(e) => setPrix(Number(e.target.value))} aria-label="Apple price" />
        <small className="muted">← drag left to make Apple fall</small>
        <div className="d-gauge3">
          <span className="z1">Safe</span><span className="z2">Watch</span><span className="z3">Protection</span>
          <i className={`d-ndl ${zone}`} style={{ left: `${Math.min(100, ltv * 100)}%` }}><em>{Math.round(ltv * 100)}%</em></i>
        </div>
        <div className={`d-msg ${zone}`}><M />{msg.t}</div>
      </div>
    </Chapter>
  )
}

export function DiscoverPage() {
  return (
    <div className="d">
      <Hero />
      <Intro />
      <Need />
      <Solution />
      <Versus />
      <Flex />
      <OneYear />
      <Fall />
      <section className="d-final">
        <h2>Borrow <span className="v-hl">without selling.</span></h2>
        <div className="p-cta"><a className="btn primary d-big" href="#cash">Try it</a><a className="btn d-big" href="#presentation">Watch the video</a></div>
        <small className="muted">Stellar testnet · test tokens · tax rules depend on your country</small>
      </section>
    </div>
  )
}
