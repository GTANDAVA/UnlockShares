import {
  ArrowDown, Banknote, Briefcase, Calendar, Car, Check, Film, House, Lock, LockOpen, Pause, Play, RotateCcw, ShieldCheck, TrendingUp, TriangleAlert, X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronDown, ExternalLink, FileCode2, Gauge as GaugeIc, KeyRound, LifeBuoy } from 'lucide-react'
import { chain } from '../chainConfig'
import { useDemo } from '../lib/useDemo'
import { DEMO } from '../services/mockDemo'

// « UnlockShares en 60 secondes » : une vidéo en motion design, rendue en direct dans la page.
// Un seul moteur : chaque scène reçoit sa progression p (0 → 1) et calcule ses animations à partir de p.
// p vient soit de l'horloge (mode vidéo), soit de la position de défilement (mode scroll).

// ---------- petits outils d'animation ----------

const clamp = (x: number) => Math.max(0, Math.min(1, x))
const ease = (x: number) => 1 - (1 - x) ** 3
/** Progression adoucie entre les instants a et b de la scène */
const k = (p: number, a: number, b: number) => ease(clamp((p - a) / (b - a)))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const eur = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} €`

/** Entrée : fondu + glissement depuis le bas (ou un autre côté) */
const enter = (t: number, dx = 0, dy = 3): CSSProperties => ({
  opacity: t,
  transform: `translate(${(1 - t) * dx}cqw, ${(1 - t) * dy}cqw)`,
})
/** Entrée « pop » avec rebond */
const pop = (t: number): CSSProperties => {
  const s = t <= 0 ? 0.6 : 0.6 + 0.4 * t + Math.sin(t * Math.PI) * 0.12
  return { opacity: Math.min(1, t * 2), transform: `scale(${s})` }
}

function Share({ locked = false, style }: { locked?: boolean; style?: CSSProperties }) {
  return (
    <span className={`v-share ${locked ? 'locked' : ''}`} style={style}>
      {locked ? <Lock className="v-ic" /> : <span className="v-apple" />}AAPL
    </span>
  )
}

function Title({ p, a = 0.02, b = 0.14, kicker, children }: { p: number; a?: number; b?: number; kicker?: string; children: ReactNode }) {
  const t = k(p, a, b)
  return (
    <div className="v-title" style={enter(t)}>
      {kicker && <span className="v-kicker">{kicker}</span>}
      <h3>{children}</h3>
    </div>
  )
}

// ---------- les scènes ----------

type Scene = { id: string; label: string; dur: number; render: (p: number) => ReactNode }

/** 0. Accroche */
function Intro(p: number) {
  return (
    <div className="v-center">
      <div className="v-row v-shares10">
        {Array.from({ length: 10 }, (_, i) => {
          const t = k(p, 0.05 + i * 0.025, 0.2 + i * 0.025)
          return <Share key={i} style={{ opacity: t, transform: `translateY(${(1 - t) * -8}cqw) rotate(${(1 - t) * (i % 2 ? 12 : -12)}deg)` }} />
        })}
      </div>
      <div className="v-big" style={enter(k(p, 0.3, 0.45))}>
        Léa owns <span className="v-hl">1 000 €</span> of Apple shares.
      </div>
      <div className="v-sub" style={enter(k(p, 0.55, 0.7))}>
        But her wallet is empty: <b className="v-wallet0" style={{ transform: `translateX(${Math.sin(p * 90) * k(p, 0.7, 0.75) * (1 - k(p, 0.85, 0.9)) * 0.6}cqw)` }}>0 €</b>
      </div>
      <div className="v-sub muted" style={enter(k(p, 0.75, 0.88))}>Shares are worth money… but you can’t pay with them.</div>
    </div>
  )
}

const BESOINS = [
  { icon: Briefcase, titre: 'Cash advance', ex: 'A client pays in 60 days, salaries are due Friday.', m: '3 000 €' },
  { icon: Car, titre: 'Emergency', ex: 'Car repair, dentist, a leaking roof.', m: '400 €' },
  { icon: TrendingUp, titre: 'Investment', ex: 'A deal or a flat deposit you don’t want to miss.', m: '5 000 €' },
  { icon: Banknote, titre: 'Off-ramp', ex: 'Pay rent in euros while your savings stay invested.', m: '900 €' },
]

/** 1. Le besoin */
function Besoin(p: number) {
  const actif = Math.min(3, Math.floor(clamp((p - 0.15) / 0.65) * 4))
  return (
    <>
      <Title p={p} kicker="01 · The need">When do you need cash, fast?</Title>
      <div className="v-grid4">
        {BESOINS.map(({ icon: Icon, titre, ex, m }, i) => {
          const t = k(p, 0.15 + i * 0.16, 0.27 + i * 0.16)
          return (
            <div key={titre} className={`v-card ${i === actif && t > 0.9 ? 'on' : ''}`} style={pop(t)}>
              <span className="v-badge"><Icon className="v-ic" /></span>
              <b>{titre}</b>
              <small>{ex}</small>
              <span className="v-amount">{m}</span>
            </div>
          )
        })}
      </div>
      <div className="v-foot" style={enter(k(p, 0.86, 0.96))}>Selling your shares for this? There is a better way.</div>
    </>
  )
}

/** 2. La solution : les actions vont au coffre, les USDC sortent */
function Solution(p: number) {
  const verrou = k(p, 0.42, 0.5)
  const cash = lerp(0, 400, k(p, 0.5, 0.8))
  return (
    <>
      <Title p={p} kicker="02 · The solution">Lock your shares. Borrow against them.</Title>
      <div className="v-lane">
        <div className="v-col">
          <div className="v-stack">
            {Array.from({ length: 10 }, (_, i) => {
              const t = k(p, 0.15 + i * 0.022, 0.32 + i * 0.022)
              return <Share key={i} style={{ position: 'absolute', top: `${i * 0.55}cqw`, opacity: 1 - k(t, 0.85, 1), transform: `translateX(${t * 30}cqw) scale(${1 - t * 0.4})` }} />
            })}
          </div>
          <small>Léa’s 10 shares</small>
        </div>
        <div className="v-col">
          <div className={`v-vault ${verrou > 0.5 ? 'shut' : ''}`} style={{ boxShadow: `0 0 0 ${Math.sin(verrou * Math.PI) * 2}cqw color-mix(in srgb, var(--yellow) 30%, transparent)` }}>
            {verrou > 0.5 ? <Lock className="v-ic xl" /> : <LockOpen className="v-ic xl" />}
            <span className="v-vault-n">{Math.round(10 * k(p, 0.18, 0.42))} AAPL</span>
          </div>
          <small>Smart contract on Stellar</small>
        </div>
        <div className="v-col">
          <div className="v-wallet">
            {Array.from({ length: 5 }, (_, i) => {
              const t = k(p, 0.5 + i * 0.05, 0.62 + i * 0.05)
              return <span key={i} className="v-coin" style={{ opacity: t <= 0 ? 0 : t < 0.8 ? 1 : (1 - t) / 0.2, transform: `translateX(${(t - 1) * 30}cqw) translateY(${-Math.sin(t * Math.PI) * 4}cqw)` }}>$</span>
            })}
            <b>{eur(cash)}</b>
          </div>
          <small>Léa’s wallet</small>
        </div>
      </div>
      <div className="v-chips" style={enter(k(p, 0.8, 0.92))}>
        <span>Up to 50 % of their value</span><span>In 5 seconds</span><span>24/7, no banker</span>
      </div>
    </>
  )
}

/** 3. Vendre ou emprunter */
function Comparaison(p: number) {
  const parties = k(p, 0.12, 0.3)
  const verrou = k(p, 0.48, 0.58)
  const liste = (items: string[], ok: boolean, a: number) =>
    items.map((txt, i) => (
      <li key={txt} style={enter(k(p, a + i * 0.06, a + 0.08 + i * 0.06), ok ? 3 : -3, 0)}>
        {ok ? <Check className="v-ic ok" /> : <X className="v-ic ko" />}{txt}
      </li>
    ))
  return (
    <>
      <Title p={p} kicker="03 · Why not just sell?">Selling vs. borrowing 400 €</Title>
      <div className="v-duel">
        <div className="v-side ko" style={enter(k(p, 0.06, 0.16), -4, 0)}>
          <b>Sell 4 shares</b>
          <div className="v-row sm">
            {Array.from({ length: 10 }, (_, i) => (
              <Share key={i} style={i < 4 ? { opacity: 1 - parties, transform: `translateY(${-parties * 6}cqw) rotate(${parties * 30}deg)` } : undefined} />
            ))}
          </div>
          <ul>{liste(['4 shares gone for good', 'The sale can be taxed', 'You miss the rebound'], false, 0.25)}</ul>
          <span className="v-stamp" style={{ opacity: k(p, 0.4, 0.46), transform: `rotate(-12deg) scale(${lerp(2, 1, k(p, 0.4, 0.46))})` }}>SOLD</span>
        </div>
        <div className="v-side ok" style={enter(k(p, 0.3, 0.42), 4, 0)}>
          <b>Borrow 400 €</b>
          <div className="v-row sm">{Array.from({ length: 10 }, (_, i) => <Share key={i} locked={verrou > 0.5} />)}</div>
          <ul>{liste(['All 10 shares still yours', 'No sale, no tax on a sale*', '100 % of the upside kept'], true, 0.6)}</ul>
          <span className="v-stamp ok" style={{ opacity: k(p, 0.82, 0.88), transform: `rotate(-8deg) scale(${lerp(2, 1, k(p, 0.82, 0.88))})` }}>STILL YOURS</span>
        </div>
      </div>
      <div className="v-note" style={{ opacity: k(p, 0.85, 0.95) }}>* Tax rules depend on your country.</div>
    </>
  )
}

/** 4. Remboursement flexible */
const PAIEMENTS = [
  { quand: 'Month 1', quoi: 'pays 50 €', reste: 350 },
  { quand: 'Month 3', quoi: 'pays 0 €, no penalty', reste: 350 },
  { quand: 'Month 7', quoi: 'pays 200 €', reste: 150 },
  { quand: 'Whenever', quoi: 'repays the rest', reste: 0 },
]
function Flexibilite(p: number) {
  let dette = 400
  PAIEMENTS.forEach((x, i) => { dette = lerp(dette, x.reste, k(p, 0.2 + i * 0.16, 0.3 + i * 0.16)) })
  const libre = k(p, 0.78, 0.86)
  return (
    <>
      <Title p={p} kicker="04 · Flexible repayment">Pay back when you want, what you want.</Title>
      <div className="v-flex">
        <div className="v-debt">
          <small>Debt</small>
          <b>{eur(dette)}</b>
          <div className="v-bar"><span style={{ width: `${(dette / 400) * 100}%` }} /></div>
          <div className="v-row sm">{Array.from({ length: 10 }, (_, i) => <Share key={i} locked={libre < 0.5} style={{ transform: `translateY(${-Math.sin(libre * Math.PI) * (i % 2 ? 1.5 : 2.5)}cqw)` }} />)}</div>
          <small style={{ opacity: libre }}>Shares unlocked: back in Léa’s wallet.</small>
        </div>
        <ol className="v-timeline">
          {PAIEMENTS.map((x, i) => {
            const t = k(p, 0.16 + i * 0.16, 0.24 + i * 0.16)
            return (
              <li key={x.quand} style={enter(t, 3, 0)} className={t > 0.9 ? 'on' : ''}>
                <Calendar className="v-ic" /><b>{x.quand}</b><span>{x.quoi}</span>
              </li>
            )
          })}
        </ol>
      </div>
      <div className="v-chips" style={enter(k(p, 0.86, 0.96))}>
        <span>No fixed schedule</span><span>Any amount</span><span>No early-repayment fee</span><span>Interest only on what you owe</span>
      </div>
    </>
  )
}

/** 5. Un an plus tard */
function UnAnPlusTard(p: number) {
  const trace = k(p, 0.1, 0.45)
  const prix = lerp(100, 120, trace)
  const barres = k(p, 0.5, 0.7)
  // Courbe : un cours qui monte en zigzag de 100 à 120
  const pts = [[0, 100], [1, 96], [2, 104], [3, 101], [4, 109], [5, 106], [6, 114], [7, 112], [8, 120]]
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x * 37.5},${(130 - y) * 6}`).join(' ')
  return (
    <>
      <Title p={p} kicker="05 · One year later">Apple went from 100 € to 120 €.</Title>
      <div className="v-split">
        <div className="v-chart">
          <span className="v-price up">Apple {eur(prix)}</span>
          <svg viewBox="0 0 300 240" preserveAspectRatio="none" aria-hidden>
            <path d={d} pathLength={1} fill="none" stroke="var(--safe)" strokeWidth="4" strokeLinejoin="round" strokeDasharray="1" strokeDashoffset={1 - trace} vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
        <div className="v-results">
          <div className="v-res">
            <span>If she had sold</span>
            <div className="v-hbar"><span style={{ width: `${barres * (720 / 785) * 100}%` }} /></div>
            <b>{eur(lerp(0, 720, barres))}</b><small>6 shares × 120 €</small>
          </div>
          <div className="v-res win">
            <span>She borrowed</span>
            <div className="v-hbar win"><span style={{ width: `${barres * 100}%` }} /></div>
            <b>{eur(lerp(0, 785, barres))}</b><small>10 shares × 120 € − 415 € repaid (400 € + 3,75 % interest)</small>
          </div>
          <div className="v-win" style={pop(k(p, 0.75, 0.85))}>+65 € and she still owns her 10 shares</div>
        </div>
      </div>
    </>
  )
}

/** 6. Et si l'action chute ? */
function Chute(p: number) {
  const prix = p < 0.6 ? lerp(100, 70, k(p, 0.1, 0.35)) : lerp(70, 50, k(p, 0.6, 0.75))
  const ltv = 415 / (10 * prix)
  const zone = ltv <= 0.5 ? 'safe' : ltv <= 0.8 ? 'watch' : 'danger'
  const liquide = k(p, 0.8, 0.86)
  return (
    <>
      <Title p={p} kicker="06 · What if the share falls?">A safety net, in three zones.</Title>
      <div className="v-split">
        <div className="v-drop">
          <span className={`v-price ${prix < 100 ? 'down' : ''}`}>Apple {eur(prix)}</span>
          <div className="v-gauge">
            <span className="v-zone z1">Safe</span><span className="v-zone z2">Watch</span><span className="v-zone z3">Protection</span>
            <span className={`v-needle ${zone}`} style={{ left: `${Math.min(100, ltv * 100)}%` }}><i>{Math.round(ltv * 100)} %</i></span>
          </div>
          <small className="muted">Debt (415 €) ÷ value of her 10 shares</small>
          <div className="v-row sm">
            {Array.from({ length: 10 }, (_, i) => (
              <Share key={i} locked style={i < 6.5 ? { opacity: 1 - liquide * (i < 6 ? 1 : 0.5), transform: `translateX(${liquide * -4}cqw)` } : undefined} />
            ))}
          </div>
        </div>
        <div className="v-msgs">
          <div className="v-msg safe" style={enter(k(p, 0.05, 0.15), 3, 0)}>
            <ShieldCheck className="v-ic" /><span><b>Big cushion.</b> She borrowed at most 50 %: Apple must fall about 48 % before anything happens.</span>
          </div>
          <div className="v-msg watch" style={enter(k(p, 0.38, 0.48), 3, 0)}>
            <TriangleAlert className="v-ic" /><span><b>At 70 € (59 %): watch zone.</b> She can pay back a little or add shares, whenever she wants.</span>
          </div>
          <div className="v-msg danger" style={enter(k(p, 0.78, 0.86), 3, 0)}>
            <ArrowDown className="v-ic" /><span><b>At 50 € (83 %): protection sale.</b> A liquidator repays 311 € of her debt and receives 6,5 shares (+5 % bonus).</span>
          </div>
          <div className="v-msg" style={enter(k(p, 0.88, 0.95), 3, 0)}>
            <House className="v-ic" /><span><b>Léa keeps</b> the 400 € she borrowed, 3,5 shares and a healthy loan back at 60 %. Never more than her shares are lost.</span>
          </div>
        </div>
      </div>
    </>
  )
}

/** 7. Fin */
function Outro(p: number) {
  return (
    <div className="v-center">
      <div className="v-logo" style={pop(k(p, 0.05, 0.25))}><Lock className="v-ic xl" /></div>
      <div className="v-big" style={enter(k(p, 0.2, 0.35))}>Borrow <span className="v-hl">without selling.</span></div>
      <div className="v-sub" style={enter(k(p, 0.35, 0.5))}>UnlockShares · tokenized shares as collateral · built on Stellar</div>
      <div className="v-cta" style={enter(k(p, 0.5, 0.65))} onClick={(e) => e.stopPropagation()}>
        <a className="btn primary" href="#emprunter">Try it: borrow</a>
        <a className="btn" href="#preter">Earn as a lender</a>
      </div>
    </div>
  )
}

const SCENES: Scene[] = [
  { id: 'intro', label: 'Intro', dur: 6, render: Intro },
  { id: 'besoin', label: 'The need', dur: 10, render: Besoin },
  { id: 'solution', label: 'The solution', dur: 8, render: Solution },
  { id: 'vs', label: 'vs. selling', dur: 10, render: Comparaison },
  { id: 'flex', label: 'Flexible repayment', dur: 9, render: Flexibilite },
  { id: 'an', label: '1 year later', dur: 8, render: UnAnPlusTard },
  { id: 'chute', label: 'If it falls', dur: 12, render: Chute },
  { id: 'fin', label: 'The end', dur: 6, render: Outro },
]
const TOTAL = SCENES.reduce((s, x) => s + x.dur, 0)
const DEBUTS = SCENES.map((_, i) => SCENES.slice(0, i).reduce((s, x) => s + x.dur, 0))

function situer(t: number) {
  for (let i = SCENES.length - 1; i >= 0; i--) if (t >= DEBUTS[i]) return { i, p: clamp((t - DEBUTS[i]) / SCENES[i].dur) }
  return { i: 0, p: 0 }
}

/** La scène affichée à l'instant t, avec fondu d'entrée et de sortie */
function Stage({ t }: { t: number }) {
  const { i, p } = situer(t)
  const fondu = (i === 0 ? 1 : k(p, 0, 0.05)) * (i === SCENES.length - 1 ? 1 : 1 - k(p, 0.95, 1))
  return (
    <div className="v-stage" key={SCENES[i].id}>
      <div className="v-scene" style={{ opacity: fondu, transform: `scale(${lerp(0.97, 1, fondu)})` }}>{SCENES[i].render(p)}</div>
      <div className="v-glow" style={{ transform: `translateX(${(t / TOTAL) * 60 - 30}cqw)` }} />
    </div>
  )
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

// ---------- mode vidéo ----------

function Video() {
  // « ?t=33 » dans l'adresse ouvre la vidéo à 33 s (pratique pour partager un chapitre)
  const [t, setT] = useState(() => clamp(Number(new URLSearchParams(window.location.search).get('t')) / TOTAL || 0) * TOTAL)
  const [play, setPlay] = useState(false)
  const last = useRef(0)
  useEffect(() => {
    if (!play) return
    let raf = 0
    last.current = performance.now()
    const tick = (now: number) => {
      const dt = (now - last.current) / 1000
      last.current = now
      setT((x) => {
        const n = x + dt
        if (n >= TOTAL) { setPlay(false); return TOTAL }
        return n
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [play])
  const toggle = useCallback(() => {
    if (t >= TOTAL) setT(0)
    setPlay((x) => !x)
  }, [t])
  const { i } = situer(t)
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setT(clamp((e.clientX - r.left) / r.width) * TOTAL)
  }
  return (
    <div className="v-player" tabIndex={0} onKeyDown={(e) => { if (e.key === ' ') { e.preventDefault(); toggle() } }}>
      <div className="v-screen" onClick={toggle}>
        <Stage t={t} />
        {!play && (t === 0 || t >= TOTAL) && (
          <button className="v-bigplay" aria-label={t >= TOTAL ? 'Replay' : 'Play'}>
            {t >= TOTAL ? <RotateCcw /> : <Play />}
          </button>
        )}
      </div>
      <div className="v-controls">
        <button className="v-btn" onClick={toggle} aria-label={play ? 'Pause' : 'Play'}>{play ? <Pause className="v-ic" /> : <Play className="v-ic" />}</button>
        <div className="v-progress" onClick={seek} role="slider" aria-label="Video position" aria-valuemin={0} aria-valuemax={TOTAL} aria-valuenow={Math.round(t)}>
          <span className="v-fill" style={{ width: `${(t / TOTAL) * 100}%` }} />
          {DEBUTS.slice(1).map((d) => <span key={d} className="v-tick" style={{ left: `${(d / TOTAL) * 100}%` }} />)}
        </div>
        <span className="v-time">{mmss(t)} / {mmss(TOTAL)}</span>
      </div>
      <div className="v-chapters">
        {SCENES.map((s, j) => (
          <button key={s.id} className={j === i ? 'on' : ''} onClick={() => { setT(DEBUTS[j] + 0.01); setPlay(true) }}>{s.label}</button>
        ))}
      </div>
    </div>
  )
}

// ---------- mode défilement ----------

function Scroll() {
  const ref = useRef<HTMLDivElement>(null)
  const [t, setT] = useState(0)
  useEffect(() => {
    const maj = () => {
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const course = r.height - window.innerHeight
      setT(clamp(-r.top / Math.max(1, course)) * TOTAL)
    }
    // On relit la position à chaque image : suit aussi bien la molette, le trackpad que le clavier.
    let raf = 0
    let avant = NaN
    const boucle = () => {
      const top = ref.current?.getBoundingClientRect().top ?? 0
      if (top !== avant) { avant = top; maj() }
      raf = requestAnimationFrame(boucle)
    }
    raf = requestAnimationFrame(boucle)
    window.addEventListener('scroll', maj, { passive: true })
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', maj) }
  }, [])
  const { i } = situer(t)
  return (
    <div ref={ref} className="v-scroll" style={{ height: `${SCENES.length * 110}vh` }}>
      <div className="v-sticky">
        <div className="v-screen"><Stage t={t} /></div>
        <div className="v-dots">
          {SCENES.map((s, j) => <span key={s.id} className={j === i ? 'on' : j < i ? 'done' : ''} title={s.label} />)}
          <small>{SCENES[i].label}</small>
        </div>
      </div>
    </div>
  )
}

// ---------- hero, confiance, FAQ (autour de la vidéo) ----------

const pctLive = (x: number) => `${(x * 100).toLocaleString('en-US', { maximumFractionDigits: 2 })} %`
const usdcLive = (n: number) => `${Math.round(n).toLocaleString('en-US')} USDC`

/** Les 3 chiffres lus dans le contrat (même état que Home/Earn) ; « — » si la lecture échoue */
function useLiveRates() {
  const s = useDemo()
  if (s.mode === 'demo') return { borrow: DEMO.borrowRateLabel, lend: DEMO.lendRateLabel, cash: '288,000 USDC', note: 'Demo figures', live: false }
  const ok = s.loaded && !s.error
  return {
    borrow: ok ? pctLive(s.market.borrowRate) : '—',
    lend: ok ? pctLive(s.market.lendRate) : '—',
    cash: ok ? usdcLive(s.market.cash) : '—',
    note: ok ? 'Live from the Stellar testnet contract' : s.loaded ? 'Live figures unavailable right now' : 'Reading the contract…',
    live: ok,
  }
}

function Hero({ onWatch }: { onWatch: () => void }) {
  const r = useLiveRates()
  return (
    <section className="p-hero">
      <span className="p-kicker">UnlockShares · Stellar</span>
      <h1>Get cash from your shares.<br /><span className="v-hl">Without selling them.</span></h1>
      <p className="p-lead">Borrow USDC against your tokenized stocks, up to 50 % of their value. Repay whenever you want.</p>
      <div className="p-cta">
        <a className="btn primary" href="#emprunter">Borrow now</a>
        <button className="btn" onClick={onWatch}><Play className="v-ic" aria-hidden />Watch how it works</button>
      </div>
      <div className="p-stats">
        <div><small>Borrow rate</small><b>{r.borrow}</b><span>a year</span></div>
        <div><small>Lender yield</small><b>{r.lend}</b><span>a year</span></div>
        <div><small>Available to borrow</small><b>{r.cash}</b><span>in the pool</span></div>
      </div>
      <small className="p-live">{r.live && <i className="p-dot" />}{r.note}</small>
    </section>
  )
}

function Trust() {
  const r = useLiveRates()
  const url = `${chain.explorer}/contract/${chain.pret}`
  return (
    <section className="p-sec">
      <h2>Trust by design</h2>
      <div className="p-cards">
        <div className="p-card">
          <span className="p-ico"><KeyRound /></span>
          <b>You keep control</b>
          <p>Non-custodial. You sign every operation with Freighter. Nobody can move your shares without your signature.</p>
        </div>
        <div className="p-card">
          <span className="p-ico"><FileCode2 /></span>
          <b>Open contract</b>
          <p>The rules live in a public Stellar smart contract. Anyone can read them.</p>
          <a className="p-link" href={url} target="_blank" rel="noreferrer">See it on stellar.expert<ExternalLink className="v-ic" /></a>
        </div>
        <div className="p-card">
          <span className="p-ico"><GaugeIc /></span>
          <b>Clear prices</b>
          <p><span className="p-rate">{r.borrow}</span> borrow rate today.</p>
          <p>Rates follow pool usage: 6 % at 80 % usage, more above. No hidden fees, no early repayment penalty.</p>
        </div>
        <div className="p-card">
          <span className="p-ico"><LifeBuoy /></span>
          <b>Built-in safety cushion</b>
          <ul className="p-steps">
            <li><em>50 %</em>max borrow</li>
            <li><em>80 %</em>protection sale only from here</li>
            <li><em>60 %</em>partial sale brings the loan back here</li>
          </ul>
        </div>
      </div>
      <small className="muted p-note">Testnet demo — test tokens only, no real money.</small>
    </section>
  )
}

const FAQ: [string, string][] = [
  ['Do I lose my shares?', 'No. They are locked in the contract and come back to you when you repay.'],
  ['What does it cost?', 'An interest rate that depends on pool usage (live rate). It accrues continuously; you pay only for the time you borrow.'],
  ['Can I repay anytime?', 'Yes, any amount, any time, no penalty.'],
  ['What if the share price falls?', "Nothing happens until your debt reaches 80 % of your shares' value. Then only part of your shares is sold, just enough to bring the loan back to 60 %. The buyer gets a 5 % bonus."],
  ['Who holds my money?', 'Nobody. Everything runs on a public Stellar smart contract and your own wallet.'],
]

function Questions() {
  const [open, setOpen] = useState<number | null>(0)
  const r = useLiveRates()
  return (
    <section className="p-sec">
      <h2>Questions</h2>
      <div className="p-faq">
        {FAQ.map(([q, a], j) => (
          <div key={q} className={`p-q ${open === j ? 'on' : ''}`}>
            <button aria-expanded={open === j} onClick={() => setOpen(open === j ? null : j)}>
              {q}<ChevronDown className="v-ic" />
            </button>
            {open === j && <p>{a}{j === 1 && r.borrow !== '—' ? ` Today: ${r.borrow} a year.` : ''}</p>}
          </div>
        ))}
      </div>
    </section>
  )
}

export function PresentationPage() {
  const [mode, setMode] = useState<'video' | 'scroll'>('video')
  const videoRef = useRef<HTMLDivElement>(null)
  const watch = () => videoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return (
    <div className="v">
      <Hero onWatch={watch} />
      <div className="head" ref={videoRef} style={{ scrollMarginTop: 16, marginTop: 16 }}>
        <div>
          <h2>UnlockShares in 70 seconds</h2>
          <p className="muted">The need, the solution, why it beats selling, and what happens when the market moves.</p>
        </div>
        <div className="v-mode" role="tablist" aria-label="Viewing mode">
          <button role="tab" aria-selected={mode === 'video'} className={mode === 'video' ? 'on' : ''} onClick={() => setMode('video')}><Film className="v-ic" />Video</button>
          <button role="tab" aria-selected={mode === 'scroll'} className={mode === 'scroll' ? 'on' : ''} onClick={() => setMode('scroll')}><ArrowDown className="v-ic" />Scroll</button>
        </div>
      </div>
      {mode === 'video' ? <Video /> : (<><p className="small muted">Scroll down: the story plays as you go.</p><Scroll /></>)}
      <Trust />
      <Questions />
    </div>
  )
}
