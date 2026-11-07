// État unique lu par toutes les pages.
// Mode « testnet » quand les adresses des contrats sont configurées (chainConfig.ts),
// sinon mode « démo » avec les données simulées de Léa (mockDemo.ts).
import { chainReady } from '../chainConfig'
import * as ch from './chain'
import { DEMO, demoActions, demoStore, type DemoAction, type DemoEvent, type DemoState } from './mockDemo'

export type Kind = DemoAction

export type AppEvent = DemoEvent & { hash?: string; qui?: string; mine?: boolean }

export type AppState = Omit<DemoState, 'history'> & {
  mode: 'demo' | 'chain'
  history: AppEvent[]
  /** Adresse Freighter connectée */
  address: string | null
  xlm: number
  /** Le compte a-t-il ses jetons de test (trustlines + autorisation tAAPL) ? */
  ready: boolean
  /** Taux en fractions (0.07 = 7 % par an), lus dans le contrat */
  market: { totalLent: number; totalBorrowed: number; cash: number; demoOpen: boolean; used: number; borrowRate: number; lendRate: number }
  /** Emprunteurs connus, pour la page Contrôles de démo */
  borrowers: { address: string; shares: number; debt: number; ltv: number; liquidable: boolean }[]
  /** Action en cours (affichée à l'écran) */
  busy: string | null
  loaded: boolean
  /** Problème de lecture du réseau, affiché en bandeau */
  error: string | null
}

const EMPTY_MARKET = { totalLent: 0, totalBorrowed: 0, cash: 0, demoOpen: true, used: 0, borrowRate: 0, lendRate: 0 }

function fromDemo(s: DemoState): AppState {
  return {
    ...s,
    mode: 'demo',
    address: null,
    xlm: 9998,
    ready: true,
    market: { totalLent: 1_200_000, totalBorrowed: 912_000, cash: 288_000, demoOpen: true, used: DEMO.poolUsed, borrowRate: DEMO.borrowRate, lendRate: DEMO.lendRate },
    borrowers: s.shares ? [{ address: 'Léa (demo)', shares: s.shares, debt: s.debt, ltv: s.shares * s.price ? s.debt / (s.shares * s.price) : 0, liquidable: s.debt > s.shares * s.price * DEMO.liquidation }] : [],
    busy: null,
    loaded: true,
    error: null,
  }
}

let chainState: AppState = {
  mode: 'chain', shares: 0, walletShares: 0, debt: 0, lent: 0, usdc: 0, earnings: 0, price: 0, history: [],
  address: null, xlm: 0, ready: false, market: EMPTY_MARKET, borrowers: [], busy: null, loaded: false, error: null,
}
let demoCache: { src: DemoState; out: AppState } | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const patch = (p: Partial<AppState>) => {
  chainState = { ...chainState, ...p }
  emit()
}

export const appStore = {
  subscribe(l: () => void) {
    listeners.add(l)
    const off = chainReady ? () => {} : demoStore.subscribe(l)
    return () => {
      listeners.delete(l)
      off()
    }
  },
  get(): AppState {
    if (chainReady) return chainState
    const src = demoStore.get()
    if (demoCache?.src !== src) demoCache = { src, out: fromDemo(src) }
    return demoCache.out
  },
}

/* ---------- Rafraîchissement depuis Stellar ---------- */

let refreshing = false
export async function refresh() {
  if (!chainReady || refreshing) return
  refreshing = true
  try {
    const me = chainState.address
    const [m, evs] = await Promise.all([ch.lireMarche(), ch.lireEvenements().catch((e) => {
      console.warn('Lecture des événements impossible', e)
      return [] as ch.Evenement[]
    })])
    // L'utilisateur connecté est toujours dans la liste, même si l'historique n'a pas pu être lu.
    const list = [...new Set([...(me ? [me] : []), ...ch.emprunteurs(evs).slice(-20)])]
    const positions = await Promise.all(list.map((a) => ch.lirePosition(a).then((p) => ({ a, p })).catch(() => null)))
    const borrowers = positions
      .filter((x): x is { a: string; p: ch.Position } => !!x && (x.p.garantie > 0 || x.p.dette > 0))
      .map(({ a, p }) => ({ address: a, shares: p.garantie, debt: p.dette, ltv: p.ltv, liquidable: p.liquidable }))
    const history: AppEvent[] = evs.map((e) => ({
      date: e.date.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(',', ''),
      action: e.type,
      amount: e.montant,
      hash: e.hash,
      qui: e.qui,
      mine: !!me && (e.qui === me || e.cible === me),
    }))
    const next: Partial<AppState> = {
      price: m.prix,
      market: {
        totalLent: m.totalFourni, totalBorrowed: m.totalEmprunte, cash: m.caisse, demoOpen: m.modeDemo,
        used: m.utilisation, borrowRate: m.tauxEmprunt, lendRate: m.tauxDepot,
      },
      borrowers,
      history,
      loaded: true,
    }
    if (me) {
      const [c, p, lent] = await Promise.all([ch.lireCompte(me), ch.lirePosition(me), ch.lireFourni(me)])
      Object.assign(next, {
        xlm: c.xlm, walletShares: c.aapl, usdc: c.usdc, ready: c.trustAapl && c.trustUsdc && c.aaplAutorise,
        shares: p.garantie, debt: p.dette, lent,
        earnings: Math.max(0, lent - ch.netFourni(evs, me)),
      })
    }
    patch({ ...next, error: null })
  } catch (e) {
    patch({ loaded: true, error: `Cannot read Stellar right now (${e instanceof Error ? e.message : e}). Retrying in 10 s.` })
  } finally {
    refreshing = false
  }
}

if (chainReady) {
  void ch.adresseConnue().then((a) => {
    if (a) patch({ address: a })
    void refresh()
  })
  window.setInterval(() => void refresh(), 10_000)
  // Si l'utilisateur change de compte dans Freighter, l'appli suit ce compte.
  ch.suivreCompte((a) => {
    if (chainState.address && a !== chainState.address) {
      patch({ address: a, shares: 0, walletShares: 0, debt: 0, lent: 0, usdc: 0, earnings: 0, xlm: 0, ready: false })
      void refresh()
    }
  })
}

/* ---------- Actions (communes aux deux modes) ---------- */

async function tx(label: string, run: () => Promise<string>): Promise<string> {
  patch({ busy: `${label}: sign in Freighter…` })
  try {
    const hash = await run()
    await refresh()
    return hash
  } catch (e) {
    throw new Error(ch.messageErreur(e))
  } finally {
    patch({ busy: null })
  }
}

function need(): string {
  if (!chainState.address) throw new Error('Connect your Freighter wallet first.')
  return chainState.address
}

/** Résultat d'une action : texte du toast + lien de preuve éventuel */
export type Done = { text: string; hash?: string }

export const actions = {
  async connect(): Promise<string> {
    const a = await ch.connecter()
    patch({ address: a })
    await refresh()
    return a
  },
  disconnect() {
    patch({ address: null, shares: 0, walletShares: 0, debt: 0, lent: 0, usdc: 0, earnings: 0, xlm: 0, ready: false })
  },
  max(kind: Kind, s: AppState): number {
    if (s.mode === 'demo') return demoActions.max(kind)
    const value = s.shares * s.price
    if (kind === 'lend') return s.usdc
    if (kind === 'withdrawLend') return Math.min(s.lent, s.market.cash)
    if (kind === 'deposit') return s.walletShares
    if (kind === 'withdraw') return s.debt ? Math.max(0, s.shares - s.debt / (DEMO.ltvMax * s.price)) : s.shares
    if (kind === 'borrow') return Math.max(0, Math.min(value * DEMO.ltvMax - s.debt, s.market.cash))
    return Math.min(s.debt, s.usdc)
  },
  async run(kind: Kind, amount: number): Promise<Done> {
    if (!chainReady) return { text: `${demoActions.run(kind, amount)} (simulation)` }
    const me = need()
    const labels: Record<Kind, [string, (q: string, n: number) => Promise<string>]> = {
      lend: ['Lend', ch.pret.fournir],
      withdrawLend: ['Withdraw from pool', ch.pret.retirerFonds],
      deposit: ['Deposit shares', ch.pret.deposer],
      withdraw: ['Withdraw shares', ch.pret.retirer],
      borrow: ['Borrow', ch.pret.emprunter],
      repay: ['Pay back', ch.pret.rembourser],
    }
    const [label, fn] = labels[kind]
    const hash = await tx(label, () => fn(me, amount))
    return { text: `${label} confirmed on Stellar`, hash }
  },
  async setPrice(price: number): Promise<Done> {
    if (!chainReady) {
      demoActions.setPrice(price)
      return { text: 'Price updated (simulation)' }
    }
    const me = need()
    const hash = await tx('New price', () => ch.pret.fixerPrix(me, price))
    return { text: `Apple price set to ${price} € on Stellar`, hash }
  },
  async liquidate(target?: string): Promise<Done> {
    if (!chainReady) return { text: `${demoActions.liquidate()} (simulation)` }
    const me = need()
    const hash = await tx('Liquidation', () => ch.pret.liquider(me, target ?? me))
    return { text: 'Liquidation confirmed on Stellar', hash }
  },
  async faucet(): Promise<Done> {
    const me = need()
    patch({ busy: 'Preparing…' })
    try {
      const hash = await ch.obtenirJetons(me, (t) => patch({ busy: t }))
      await refresh()
      return { text: '100 tAAPL and 5,000 tUSDC received', hash }
    } catch (e) {
      throw new Error(ch.messageErreur(e, 'robinet'))
    } finally {
      patch({ busy: null })
    }
  },
  /** Démo : fait passer `days` jours d'un coup (365 = 1 an, 30 = 1 mois), pour voir les intérêts tomber */
  async skipDays(days: number): Promise<Done> {
    if (!chainReady) return { text: `${demoActions.skipDays(days)} (simulation)` }
    const me = need()
    const label = days === 365 ? 'Skip 1 year' : `+${days} days`
    const hash = await tx(label, () => ch.pret.avancerTemps(me, days * 86_400))
    return { text: `${days} days of interest applied on Stellar`, hash }
  },
  reset() {
    demoActions.reset()
  },
}

export { chainReady }
