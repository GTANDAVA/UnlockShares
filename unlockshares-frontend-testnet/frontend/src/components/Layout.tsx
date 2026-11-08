import {
  Banknote, BookOpen, CircleDollarSign, Presentation, CirclePlay, Clock, Droplets, FlaskConical, House, Mail, Percent, Plug, Plus, Search, Shield, TriangleAlert, Wallet,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { config, configProblem } from '../config'
import { useDemo } from '../lib/useDemo'
import { chain } from '../chainConfig'
import { court, lienCompte } from '../services/chain'
import { useDemoUi } from './demo'
import { useConnect, useFaucet } from './Onboarding'

export type PageId = 'accueil' | 'presentation' | 'activite' | 'preter' | 'emprunter' | 'demo' | 'evaluation' | 'liquidation' | 'aide' | 'retrait'
export const PAGES: PageId[] = ['accueil', 'presentation', 'activite', 'preter', 'emprunter', 'demo', 'evaluation', 'liquidation', 'aide', 'retrait']

type Item = { id?: PageId; label: string; icon: typeof House; ext?: boolean }

/* Même menu que la maquette V3. « Simulateur de risque » regroupe les pages branchées sur l'API. */
const MENU: { section?: string; items: Item[] }[] = [
  { items: [{ id: 'accueil', label: 'Home', icon: House }, { id: 'presentation', label: 'Presentation', icon: Presentation }, { id: 'activite', label: 'Activity', icon: Clock }] },
  { section: 'Explore', items: [{ id: 'preter', label: 'Earn', icon: Percent }, { id: 'emprunter', label: 'Borrow', icon: CircleDollarSign }, { id: 'retrait', label: 'Cash out', icon: Banknote }] },
  { section: 'Demo', items: [{ id: 'demo', label: 'Demo controls', icon: CirclePlay }] },
  { section: 'Protocol', items: [{ label: 'Security', icon: Shield, ext: true }, { label: 'Developer Docs', icon: BookOpen, ext: true }] },
  { section: 'Support', items: [{ label: 'Contact Support', icon: Mail, ext: true }] },
]

export function ModeBadge() {
  const connected = config.apiMode === 'http'
  const Icon = connected ? Plug : FlaskConical
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] font-medium uppercase tracking-[0.06em] ${connected ? 'border-safe text-safe' : 'border-watch text-watch'}`}
      title={connected ? `Backend: ${config.apiUrl || 'not set'}` : 'Simulated answers, no backend call'}
    >
      <Icon className="size-3.5" aria-hidden />
      {connected ? 'Connected mode' : 'Simulated mode'}
    </span>
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
  const problem = configProblem()
  const { open, toast } = useDemoUi()
  const [terms, setTerms] = useState(false)
  const s = useDemo()
  const connect = useConnect()
  const faucet = useFaucet()
  const live = s.mode === 'chain'

  return (
    <div className={`app ${terms ? 'terms-on' : ''}`}>
      <aside aria-label="Menu">
        <Logo />
        {MENU.map(({ section, items }, i) => (
          <nav key={i} aria-label={section ?? 'Main'} className="contents">
            {section && <div className="sec">{section}</div>}
            {items.map(({ id, label, icon: Icon, ext }) =>
              id ? (
                <a key={label} href={`#${id}`} className={`nav ${page === id ? 'on' : ''}`} aria-current={page === id ? 'page' : undefined}>
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
            {live && s.address && s.ready && (
              <button className="round" aria-label="Get test tokens" title="Get test tokens (once an hour)" onClick={faucet} disabled={!!s.busy}><Droplets className="i" aria-hidden /></button>
            )}
            {!live ? (
              <span className="wallet" title="No wallet is connected in this demo"><Wallet className="i" aria-hidden />Not connected</span>
            ) : s.address ? (
              <a className="wallet" href={lienCompte(s.address)} target="_blank" rel="noreferrer" title="See my account on stellar.expert"><Wallet className="i" aria-hidden />{court(s.address)}</a>
            ) : (
              <button className="wallet" onClick={connect}><Wallet className="i" aria-hidden />Connect Varial</button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2" style={{ marginTop: -10 }}>
            {live ? (
              <>
                <span className="rounded-full border border-safe px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.06em] text-safe">Stellar testnet</span>
                <span className="small muted">Real transactions on the test network · tokens have no value · <a href={lienCompte(chain.pret)} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>contract {court(chain.pret)} ↗</a></span>
              </>
            ) : (
              <>
                <span className="rounded-full border border-accent px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.06em] text-accent">Demo</span>
                <ModeBadge />
                <span className="small muted">Léa’s data is simulated · no blockchain transaction, no wallet connected.</span>
              </>
            )}
          </div>

          {problem && (
            <p role="alert" className="flex items-start gap-2 rounded-xl border border-watch p-3 text-sm text-watch">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {problem}
            </p>
          )}

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
