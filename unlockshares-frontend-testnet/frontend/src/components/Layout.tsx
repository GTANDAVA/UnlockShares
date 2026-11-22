import {
  ArrowDownToLine, Banknote, HandCoins, CircleDollarSign, Gavel, CirclePlay, Clock, Droplets, House, Percent, Plus, Search, Wallet, LogOut, Sparkles, Menu, Store, X,
} from 'lucide-react'
import { Moon, Sun } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useDemo } from '../lib/useDemo'
import { chain, hubV2 } from '../chainConfig'
import { court, jetonPret, lienCompte } from '../services/chain'
import { actions } from '../services/app'
import { useDemoUi } from './demo'
import { useConnect, useFaucet, usePasskey } from './Onboarding'
import { passkeyPossible } from '../services/passkey'

export type PageId = 'decouvrir' | 'accueil' | 'presentation' | 'activite' | 'preter' | 'emprunter' | 'demo' | 'liquidations' | 'retrait' | 'ajouter' | 'cash' | 'payer'
export const PAGES: PageId[] = ['decouvrir', 'accueil', 'presentation', 'activite', 'preter', 'emprunter', 'demo', 'liquidations', 'retrait', 'ajouter', 'cash', 'payer']

type Item = { id?: PageId; label: string; icon: typeof House; ext?: boolean }

/* Menu : uniquement des pages réelles (on-chain) ou clairement étiquetées démo / simulation. */
const MENU: { section?: string; items: Item[] }[] = [
  { items: [{ id: 'decouvrir', label: 'Discover', icon: Sparkles }, { id: 'accueil', label: 'Home', icon: House }, { id: 'activite', label: 'Activity', icon: Clock }] },
  { section: 'Explore', items: [{ id: 'cash', label: 'Get cash', icon: HandCoins }, ...(hubV2 ? [{ id: 'payer' as PageId, label: 'Pay', icon: Store }] : []), { id: 'preter', label: 'Earn', icon: Percent }, { id: 'emprunter', label: 'Borrow', icon: CircleDollarSign }, { id: 'ajouter', label: 'Add money', icon: ArrowDownToLine }, { id: 'retrait', label: 'Cash out', icon: Banknote }] },
  { section: 'Demo', items: [{ id: 'demo', label: 'Demo controls', icon: CirclePlay }, { id: 'liquidations', label: 'Liquidations', icon: Gavel }] },
]

/** Bouton soleil / lune : version nuit par défaut, choix gardé dans ce navigateur (voir index.html). */
function ThemeToggle() {
  const [nuit, setNuit] = useState(() => document.documentElement.dataset.theme !== 'light')
  const basculer = () => {
    const t = nuit ? 'light' : 'dark'
    document.documentElement.dataset.theme = t
    try { localStorage.setItem('unlockshares.theme', t) } catch { /* stockage indisponible */ }
    setNuit(!nuit)
  }
  return (
    <button className="round" onClick={basculer} aria-label={nuit ? 'Switch to day mode' : 'Switch to night mode'} title={nuit ? 'Day mode' : 'Night mode'}>
      {nuit ? <Sun className="i" aria-hidden /> : <Moon className="i" aria-hidden />}
    </button>
  )
}

function Logo() {
  return (
    <div className="logo">
      <svg className="lock" viewBox="0 0 24 24" aria-hidden>
        <path d="M8 11V7a4 4 0 0 1 7.6-1.7" fill="none" stroke="var(--yellow)" strokeWidth="2.6" strokeLinecap="round" />
        <rect x="4.5" y="11" width="15" height="10" rx="2.5" fill="var(--yellow)" />
        <circle cx="12" cy="15.5" r="1.6" fill="var(--on-yellow)" />
      </svg>
      <span>UNLOCK<br />SHARES</span>
    </div>
  )
}

export function Layout({ page, children }: { page: PageId; children: ReactNode }) {
  const { open, toast } = useDemoUi()
  const [terms, setTerms] = useState(false)
  const s = useDemo()
  const connect = useConnect()
  const passkey = usePasskey()
  const faucet = useFaucet()
  const live = s.mode === 'chain'
  // Téléphone : le menu se replie derrière un bouton ☰ ; il reste ouvert seulement sur la page où on l'a ouvert,
  // donc il se referme tout seul quand on choisit une page.
  const [menuSur, setMenuSur] = useState<PageId | null>(null)
  const menu = menuSur === page

  return (
    <div className={`app ${terms ? 'terms-on' : ''}`}>
      <aside aria-label="Menu" className={menu ? 'open' : ''}>
        <div className="side-head">
          <Logo />
          <button className="round menu-btn" onClick={() => setMenuSur(menu ? null : page)} aria-expanded={menu} aria-controls="menu-liens" aria-label={menu ? 'Close menu' : 'Open menu'}>
            {menu ? <X className="i" aria-hidden /> : <Menu className="i" aria-hidden />}
          </button>
        </div>
        <div id="menu-liens" className="menu-liens">
        {MENU.map(({ section, items }, i) => (
          <nav key={i} aria-label={section ?? 'Main'} className="contents">
            {section && <div className="sec">{section}</div>}
            {items.map(({ id, label, icon: Icon, ext }) =>
              id ? (
                <a key={label} href={`#${id}`} className={`nav ${page === id ? 'on' : ''}`} aria-current={page === id ? 'page' : undefined} onClick={() => setMenuSur(null)}>
                  <Icon className="i" aria-hidden />{label}
                </a>
              ) : (
                <button key={label} className={`nav ${ext ? 'ext' : ''}`} onClick={() => toast(`${label} links to an external page in the real app`)}>
                  <Icon className="i" aria-hidden />{label}<span className="arrow">↗</span>
                </button>
              ),
            )}
          </nav>
        ))}
        </div>
        <div className="promo">
          <Percent className="i" style={{ width: 28, height: 28 }} aria-hidden />
          <b>Borrow without selling</b>
          <span>Your tokenized shares stay yours.</span>
          <label className="switch"><input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} /> Show DeFi terms</label>
        </div>
      </aside>

      <main>
        <div className="inner">
          <div className="metabar"><span>HACKMERIDIAN 2026 · LISBON</span><span className="y">#HackMeridian26</span><span className="tri" aria-hidden>▶▶▶</span></div>
          <div className="top">
            <label className="search"><Search className="i" aria-hidden /><input placeholder="Search assets and markets" aria-label="Search" /><span className="kbd">/</span></label>
            <button className="round" aria-label="Lend" title="Lend" onClick={() => open('lend')}><Plus className="i" aria-hidden /></button>
            <ThemeToggle />
            {live && s.address && s.ready && (
              <button className="round" aria-label="Get test tokens" title={`Get test tokens: test ${s.stocks.length > 1 ? 'shares (welcome pack)' : 'Apple shares'} (hourly)${chain.distributeur ? ` + test ${jetonPret()} (daily)` : ''}`} onClick={faucet} disabled={!!s.busy}><Droplets className="i" aria-hidden /></button>
            )}
            {!live ? (
              <span className="wallet" title="No wallet is connected in this demo"><Wallet className="i" aria-hidden />Not connected</span>
            ) : s.address ? (
              <>
                <a className="wallet" href={lienCompte(s.address)} target="_blank" rel="noreferrer" title="See my account on stellar.expert"><Wallet className="i" aria-hidden />{court(s.address)}</a>
                <button className="round" aria-label="Disconnect" title="Disconnect (to switch account)" onClick={() => actions.disconnect()} disabled={!!s.busy}><LogOut className="i" aria-hidden /></button>
              </>
            ) : (
              <>
                {passkeyPossible() && <button className="wallet" onClick={() => void passkey(true)}><Wallet className="i" aria-hidden />Create account</button>}
                <button className="wallet varial" onClick={connect} title="Connect the Varial wallet (formerly Freighter)"><Wallet className="i" aria-hidden />Varial</button>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2" style={{ marginTop: -10 }}>
            {live ? (
              <>
                <span className="rounded-full border border-safe px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.06em] text-safe">Stellar testnet</span>
                <span className="small muted">Real transactions on the test network · tokens have no value · amounts in dollars, 1 {jetonPret()} = 1 dollar · <a href={lienCompte(chain.pret)} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>contract {court(chain.pret)} ↗</a></span>
              </>
            ) : (
              <>
                <span className="rounded-full border border-accent px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.06em] text-accent">Demo</span>
                <span className="small muted">Léa’s data is simulated · no blockchain transaction, no wallet connected. Amounts in dollars (1 USDC = 1 dollar).</span>
              </>
            )}
          </div>

          {children}
        </div>
      </main>
    </div>
  )
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      {title && <h2 className="title-md mb-4">{title}</h2>}
      {children}
    </section>
  )
}
