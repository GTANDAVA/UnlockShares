// Page « Discover » : présentation du site façon aave.com/app (Greg, 17/11/2026), adaptée à UnlockShares.
// Sections : promesse, vendre vs emprunter, simulateur, produits, filet de sécurité, comment ça marche,
// chiffres lus en direct dans le contrat, sécurité, FAQ, appel final. Aucun chiffre inventé : tout ce qui est
// « live » vient du contrat testnet, le reste est la règle du contrat ou une simulation affichée comme telle.
import { ArrowDownToLine, Banknote, ChevronDown, ExternalLink, FileCode2, Fingerprint, HandCoins, KeyRound, LifeBuoy, Percent, ShieldCheck, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { chain } from '../chainConfig'
import { useDemo } from '../lib/useDemo'
import { DEMO } from '../services/mockDemo'

const pct = (x: number) => `${(x * 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`
const money = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: n < 100 ? 2 : 0 })}`

/** Chiffres du contrat (testnet) ; null si la lecture échoue */
function useLive() {
  const s = useDemo()
  const demo = s.mode === 'demo'
  const ok = demo || (s.loaded && !s.error)
  return {
    ok, demo,
    borrow: demo ? DEMO.borrowRate : s.market.borrowRate,
    lend: demo ? DEMO.lendRate : s.market.lendRate,
    lent: s.market.totalLent, borrowed: s.market.totalBorrowed, cash: s.market.cash,
    price: s.market.refPrice ?? s.price,
  }
}

function Hero() {
  const r = useLive()
  return (
    <section className="d-hero">
      <span className="p-kicker">UnlockShares · on Stellar</span>
      <h1>The cash app<br /><span className="v-hl">for people who own shares.</span></h1>
      <p className="p-lead">Keep your shares. Get dollars against them in a minute, repay whenever you want, and take the cash out at a MoneyGram counter.</p>
      <div className="p-cta">
        <a className="btn primary" href="#cash">Get cash</a>
        <a className="btn" href="#presentation">Watch the 70 s video</a>
      </div>
      <small className="p-live">{r.ok && !r.demo && <i className="p-dot" />}
        {r.ok ? `Borrow at ${pct(r.borrow)} a year today · lenders earn ${pct(r.lend)}` : 'Reading the contract…'}{r.demo ? ' (demo figures)' : ''}</small>
    </section>
  )
}

function SellVsBorrow() {
  return (
    <section className="p-sec">
      <h2>Selling is final. Borrowing is not.</h2>
      <div className="d-vs">
        <div className="d-col">
          <small className="muted">Sell your shares</small>
          <ul>
            <li className="no">The shares are gone</li>
            <li className="no">You miss any future rise</li>
            <li className="no">Buying back later costs more if the price went up</li>
          </ul>
        </div>
        <div className="d-col d-us">
          <small>Borrow with UnlockShares</small>
          <ul>
            <li className="yes">Your shares stay yours, locked as a guarantee</li>
            <li className="yes">You keep every rise</li>
            <li className="yes">Up to 50% of their value in dollars, repay anytime</li>
          </ul>
        </div>
      </div>
    </section>
  )
}

function Simulator() {
  const r = useLive()
  const [n, setN] = useState(10)
  const [price, setPrice] = useState<number | null>(null)
  const p = price ?? (r.price > 0 ? Math.round(r.price * 100) / 100 : 250)
  const value = n * p
  const cash = value * 0.5
  const monthly = (cash * r.borrow) / 12
  return (
    <section className="p-sec d-sim">
      <div className="head">
        <div><h2>Simulate your cash</h2><p className="muted">How much your shares could unlock, and what it costs per month.</p></div>
        <span className="pill ef-sim">Simulation</span>
      </div>
      <div className="d-simgrid">
        <div className="d-inputs">
          <label><span className="muted small">Apple shares you own</span>
            <span className="ef-input"><input type="number" min={0} inputMode="numeric" value={n} onChange={(e) => setN(Math.max(0, Number(e.target.value) || 0))} /></span></label>
          <label><span className="muted small">Price per share {price === null && r.price > 0 ? '(today, from the price oracle)' : ''}</span>
            <span className="ef-input">$<input type="number" min={0} inputMode="decimal" value={p} onChange={(e) => setPrice(Math.max(0, Number(e.target.value) || 0))} /></span></label>
          <input type="range" min={1} max={200} value={Math.min(200, n)} onChange={(e) => setN(Number(e.target.value))} aria-label="Number of shares" />
        </div>
        <div className="d-out">
          <small className="muted">You could get up to</small>
          <b className="num">{money(cash)}</b>
          <div className="d-outline"><span className="muted">Your shares are worth</span><span>{money(value)}</span></div>
          <div className="d-outline"><span className="muted">Interest per month at {pct(r.borrow)}</span><span>{money(monthly)}</span></div>
          <div className="d-outline"><span className="muted">Shares you keep</span><span>{n} AAPL</span></div>
          <a className="btn primary" href="#cash">Get cash</a>
        </div>
      </div>
      <p className="muted small">Simulation with the 50% borrowing limit and today's borrow rate, which moves with pool usage. Testnet only, not financial advice.</p>
    </section>
  )
}

const PRODUCTS = [
  { href: '#cash', icon: HandCoins, title: 'Get cash', text: 'Lock tokenized shares, receive USDC. One screen, one decision.' },
  { href: '#preter', icon: Percent, title: 'Earn', text: 'Lend USDC to the pool and earn the interest borrowers pay.' },
  { href: '#ajouter', icon: ArrowDownToLine, title: 'Add money', text: 'Bank transfer or cash at MoneyGram, turned into USDC.' },
  { href: '#retrait', icon: Banknote, title: 'Cash out', text: 'Pick up your dollars as local cash at a MoneyGram counter.' },
]

function Products() {
  return (
    <section className="p-sec">
      <h2>Everything in one app</h2>
      <div className="d-prods">
        {PRODUCTS.map(({ href, icon: I, title, text }) => (
          <a key={title} className="p-card d-prod" href={href}><span className="p-ico"><I /></span><b>{title}</b><p>{text}</p><span className="d-go">Open →</span></a>
        ))}
      </div>
    </section>
  )
}

function Cushion() {
  return (
    <section className="p-sec">
      <h2>A safety cushion, built in</h2>
      <p className="muted">If the share price falls, nothing happens until your loan reaches 80% of your shares' value. Then only part is sold, just enough to come back to 60%.</p>
      <div className="d-bar" aria-hidden>
        <span className="d-z safe" style={{ width: '50%' }}>Borrow up to 50%</span>
        <span className="d-z watch" style={{ width: '30%' }}>Cushion</span>
        <span className="d-z danger" style={{ width: '20%' }}>80%+ partial sale</span>
      </div>
      <div className="d-cols3">
        <div><Undo2 className="d-ic" /><b>Repay anytime</b><p className="muted">Any amount, no penalty. Interest only for the time you borrow.</p></div>
        <div><LifeBuoy className="d-ic" /><b>Partial, not total</b><p className="muted">A protection sale never takes everything, only what brings the loan back to 60%.</p></div>
        <div><ShieldCheck className="d-ic" /><b>Real prices</b><p className="muted">Two independent sources must agree within 1% before a price is accepted.</p></div>
      </div>
    </section>
  )
}

function HowItWorks() {
  return (
    <section className="p-sec">
      <h2>How UnlockShares works</h2>
      <ol className="d-steps">
        <li><b>Lenders</b> put USDC in a shared pool and earn interest.</li>
        <li><b>Borrowers</b> lock tokenized shares and take up to 50% of their value from the pool.</li>
        <li><b>The contract</b> sets the rate from pool usage and protects lenders with the safety cushion.</li>
      </ol>
    </section>
  )
}

function Numbers() {
  const r = useLive()
  if (!r.ok) return null
  return (
    <section className="p-sec">
      <h2>Live on Stellar</h2>
      <div className="d-nums">
        <div><b className="num">{r.demo ? DEMO.poolDeposits : money(r.lent)}</b><small className="muted">lent to the pool</small></div>
        <div><b className="num">{r.demo ? '$912k' : money(r.borrowed)}</b><small className="muted">borrowed against shares</small></div>
        <div><b className="num">{pct(r.borrow)}</b><small className="muted">borrow rate today</small></div>
      </div>
      <small className="muted">{r.demo ? 'Demo figures.' : 'Read live from the Stellar testnet contract. Test tokens, no real money.'}</small>
    </section>
  )
}

function Security() {
  const url = `${chain.explorer}/contract/${chain.pret}`
  return (
    <section className="p-sec">
      <h2>Security you can check</h2>
      <div className="p-cards">
        <div className="p-card"><span className="p-ico"><Fingerprint /></span><b>Fingerprint or Face ID</b><p>Create an account with a passkey. No seed phrase, no password.</p></div>
        <div className="p-card"><span className="p-ico"><KeyRound /></span><b>You keep control</b><p>Non-custodial. Nobody, not even us, can move your shares or dollars without your signature.</p></div>
        <div className="p-card"><span className="p-ico"><FileCode2 /></span><b>Open contract</b><p>The rules live in a public Stellar smart contract, tested before every release.</p>
          <a className="p-link" href={url} target="_blank" rel="noreferrer">See it on stellar.expert<ExternalLink className="v-ic" /></a></div>
      </div>
      <small className="muted">No external audit yet: planned before any real-money launch.</small>
    </section>
  )
}

const FAQ: [string, string][] = [
  ['What is UnlockShares?', 'An app on Stellar that lets you borrow dollars (USDC) against tokenized shares, without selling them, and lets others earn by lending.'],
  ['Do I lose my shares?', 'No. They are locked in the contract and come back to you when you repay.'],
  ['Is the rate fixed?', 'No. It follows how much of the pool is borrowed: up to 6% a year at 80% usage, higher above. You see the live rate before you sign.'],
  ['What if the price falls?', 'Nothing happens until your loan reaches 80% of your shares\' value. Then only part of your shares is sold, to bring it back to 60%.'],
  ['Who holds my money?', 'Nobody. Everything runs on a public Stellar smart contract and your own account.'],
  ['Is this real money?', 'Not yet. This is the Stellar testnet: test tokens, no real value.'],
]

function Questions() {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <section className="p-sec">
      <h2>FAQs</h2>
      <div className="p-faq">
        {FAQ.map(([q, a], j) => (
          <div key={q} className={`p-q ${open === j ? 'on' : ''}`}>
            <button aria-expanded={open === j} onClick={() => setOpen(open === j ? null : j)}>{q}<ChevronDown className="v-ic" /></button>
            {open === j && <p>{a}</p>}
          </div>
        ))}
      </div>
    </section>
  )
}

function FinalCta() {
  return (
    <section className="d-final">
      <h2>Keep your shares. Unlock your cash.</h2>
      <div className="p-cta"><a className="btn primary" href="#cash">Get cash</a><a className="btn" href="#preter">Earn</a></div>
    </section>
  )
}

export function DiscoverPage() {
  return (
    <div className="v d">
      <Hero />
      <SellVsBorrow />
      <Simulator />
      <Products />
      <Cushion />
      <HowItWorks />
      <Numbers />
      <Security />
      <Questions />
      <FinalCta />
    </div>
  )
}
