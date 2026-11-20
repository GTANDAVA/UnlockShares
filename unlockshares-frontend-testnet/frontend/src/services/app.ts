// État unique lu par toutes les pages.
// Mode « testnet » quand les adresses des contrats sont configurées (chainConfig.ts),
// sinon mode « démo » avec les données simulées de Léa (mockDemo.ts).
import { chain, chainReady, hubMode } from '../chainConfig'
import * as ch from './chain'
import * as pk from './passkey'
import { DEMO, demoActions, demoStore, type DemoAction, type DemoEvent, type DemoState } from './mockDemo'

export type Kind = DemoAction

export type AppEvent = DemoEvent & { hash?: string; qui?: string; mine?: boolean }

/** Une action acceptée en garantie, avec ses règles (fractions : 0.5 = 50 %). */
export type Stock = {
  jeton: string; ticker: string; nom: string; fonds: boolean
  ltvMax: number; seuil: number; bonus: number
  /** Taux d'emprunt annuel contre cette action (hub : base + prime) */
  rate: number; prime: number
  active: boolean; refPrice: number; oracle: boolean; priceDate: Date | null
  /** Ce qui peut encore être emprunté contre cette action (plafond du spoke), Infinity hors hub */
  capLeft: number; borrowed: number; plafond: number
}
/** Une action vue par l'utilisateur : règles + sa position + ce qu'il a dans son portefeuille */
export type StockView = Stock & { shares: number; walletShares: number; debt: number; price: number; ltv: number; liquidable: boolean; demoPrice: boolean; safetyPrice: number }

const APPLE: Stock = {
  jeton: chain.taapl, ticker: 'AAPL', nom: 'Apple', fonds: false, ltvMax: DEMO.ltvMax, seuil: DEMO.liquidation, bonus: 0.05,
  rate: DEMO.borrowRate, prime: 0, active: true, refPrice: 0, oracle: false, priceDate: null, capLeft: Infinity, borrowed: 0, plafond: 1,
}

export type AppState = Omit<DemoState, 'history'> & {
  mode: 'demo' | 'chain'
  history: AppEvent[]
  /** Adresse connectée : compte Varial (G…) ou compte passkey (C…) */
  address: string | null
  xlm: number
  /** Le compte a-t-il ses jetons de test (trustlines + autorisation tAAPL) ? */
  ready: boolean
  /** Taux en fractions (0.07 = 7 % par an), lus dans le contrat */
  market: { totalLent: number; totalBorrowed: number; cash: number; demoOpen: boolean; used: number; borrowRate: number; lendRate: number
    /** V2 : prix de référence (admin). Chaque position peut avoir son propre prix de démo, au plus égal à celui-ci. */
    refPrice?: number
    /** V2 : dette max par adresse, et part max de la caisse par emprunt (fraction) */
    capPerAddress?: number; capCashShare?: number }
  /** Action choisie : les champs shares / walletShares / debt / price ci-dessus sont ceux de CETTE action. */
  stock: Stock
  /** Hub : toutes les actions acceptées, avec la position de l'utilisateur sur chacune. Hors hub : Apple seule. */
  stocks: StockView[]
  /** Emprunteurs connus (une ligne par emprunteur ET par action), pour les pages Liquidations et Contrôles de démo */
  borrowers: { address: string; shares: number; debt: number; ltv: number; liquidable: boolean; price?: number; jeton?: string; ticker?: string }[]
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
    borrowers: s.shares ? [{ address: 'Léa (demo)', shares: s.shares, debt: s.debt, ltv: s.shares * s.price ? s.debt / (s.shares * s.price) : 0, liquidable: s.debt > s.shares * s.price * DEMO.liquidation, ticker: 'AAPL' }] : [],
    stock: { ...APPLE, refPrice: s.price },
    stocks: [vueApple(s, { ...APPLE, refPrice: s.price })],
    busy: null,
    loaded: true,
    error: null,
  }
}

function vueApple(s: { shares: number; walletShares: number; debt: number; price: number }, st: Stock): StockView {
  const valeur = s.shares * s.price
  const ltv = valeur ? s.debt / valeur : 0
  return { ...st, shares: s.shares, walletShares: s.walletShares, debt: s.debt, price: s.price, ltv, liquidable: s.debt > 0 && ltv > st.seuil, demoPrice: false, safetyPrice: s.shares ? s.debt / (s.shares * st.seuil) : 0 }
}

let chainState: AppState = {
  mode: 'chain', shares: 0, walletShares: 0, debt: 0, lent: 0, usdc: 0, earnings: 0, price: 0, history: [],
  address: null, xlm: 0, ready: false, market: EMPTY_MARKET, borrowers: [], busy: null, loaded: false, error: null,
  stock: APPLE, stocks: [],
}

/** Recopie l'action choisie dans les champs « une seule action » lus par les pages. */
function choisir(stocks: StockView[], jeton: string | null): Partial<AppState> {
  const v = stocks.find((x) => x.jeton === jeton) ?? stocks.find((x) => x.shares > 0 || x.debt > 0) ?? stocks[0]
  if (!v) return {}
  const { shares, walletShares, debt, price, ltv: _l, liquidable: _q, demoPrice: _d, safetyPrice: _p, ...stock } = v
  return { stock, shares, walletShares, debt, price }
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
    // Le nom et l'émetteur des jetons viennent du contrat (lu une seule fois).
    await ch.chargerJetons()
    if (hubMode) {
      await refreshHub()
      return
    }
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
      .map(({ a, p }) => ({ address: a, shares: p.garantie, debt: p.dette, ltv: p.ltv, liquidable: p.liquidable, price: p.prix }))
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
        used: m.utilisation, borrowRate: m.tauxEmprunt, lendRate: m.tauxDepot, refPrice: m.prix, capPerAddress: m.plafondFixe, capCashShare: m.plafondCaisse,
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
        // V2 : chaque position a son propre prix de démo ; on affiche celui de l'utilisateur.
        ...(p.prix !== undefined ? { price: p.prix } : {}),
        earnings: Math.max(0, lent - ch.netFourni(evs, me)),
      })
    }
    const apple: Stock = { ...APPLE, rate: m.tauxEmprunt, refPrice: m.prix }
    const vue = vueApple({ shares: next.shares ?? chainState.shares, walletShares: next.walletShares ?? chainState.walletShares, debt: next.debt ?? chainState.debt, price: next.price ?? m.prix }, apple)
    Object.assign(next, { stock: apple, stocks: [vue] })
    patch({ ...next, error: null })
  } catch (e) {
    patch({ loaded: true, error: `Cannot read Stellar right now (${e instanceof Error ? e.message : e}). Retrying in 10 s.` })
  } finally {
    refreshing = false
  }
}

const dateCourte = (d: Date) => d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(',', '')

/** Hub & spokes : la caisse, les actions acceptées, et une position par action. */
async function refreshHub() {
  const me = chainState.address
  const [m, spokes, evs] = await Promise.all([ch.lireMarche(), ch.lireSpokes(), ch.lireEvenements().catch((e) => {
    console.warn('Lecture des événements impossible', e)
    return [] as ch.Evenement[]
  })])
  // Positions de tous les emprunteurs vus (une lecture par adresse renvoie toutes ses actions).
  const adresses = [...new Set([...(me ? [me] : []), ...ch.emprunteursHub(evs).map((x) => x.qui).slice(-20)])]
  const lus = await Promise.all(adresses.map((a) => ch.lirePositions(a).then((ps) => ({ a, ps })).catch(() => ({ a, ps: [] as ch.PositionHub[] }))))
  const borrowers = lus.flatMap(({ a, ps }) => ps.map((p) => ({ address: a, shares: p.garantie, debt: p.dette, ltv: p.ltv, liquidable: p.liquidable, price: p.prix, jeton: p.jeton, ticker: ch.tickerDe(p.jeton) })))
  const miennes = new Map((lus.find((x) => x.a === me)?.ps ?? []).map((p) => [p.jeton, p]))
  const [c, lent] = me ? await Promise.all([ch.lireCompte(me), ch.lireFourni(me)]) : [null, 0]
  const stocks: StockView[] = spokes.map((sp) => {
    const p = miennes.get(sp.jeton)
    const st: Stock = {
      jeton: sp.jeton, ticker: sp.ticker, nom: sp.nom, fonds: sp.fonds, ltvMax: sp.ltvMax, seuil: sp.seuil, bonus: sp.bonus,
      rate: sp.tauxEmprunt, prime: sp.prime, active: sp.actif, refPrice: sp.prix, oracle: sp.oracle, priceDate: sp.prixMaj,
      capLeft: sp.restePlafond, borrowed: sp.emprunte, plafond: sp.plafond,
    }
    return {
      ...st, shares: p?.garantie ?? 0, walletShares: c?.actions?.[sp.jeton]?.solde ?? 0, debt: p?.dette ?? 0, price: p?.prix || sp.prix,
      ltv: p?.ltv ?? 0, liquidable: p?.liquidable ?? false, demoPrice: p?.prixDemo ?? false, safetyPrice: p?.prixLiquidation ?? 0,
    }
  })
  const choix = choisir(stocks, chainState.stock.jeton || null)
  const history: AppEvent[] = evs.map((e) => ({ date: dateCourte(e.date), action: e.type, amount: e.montant, hash: e.hash, qui: e.qui, mine: !!me && (e.qui === me || e.cible === me) }))
  patch({
    ...choix,
    stocks,
    market: {
      totalLent: m.totalFourni, totalBorrowed: m.totalEmprunte, cash: m.caisse, demoOpen: m.modeDemo, used: m.utilisation,
      // Taux d'emprunt de l'action choisie (base + prime) ; le rendement prêteur est la moyenne, primes comprises.
      borrowRate: choix.stock?.rate ?? m.tauxEmprunt, lendRate: m.tauxDepot, refPrice: choix.stock?.refPrice, capPerAddress: m.plafondFixe, capCashShare: m.plafondCaisse,
    },
    borrowers,
    history,
    loaded: true,
    error: null,
    ...(me && c
      ? { xlm: c.xlm, usdc: c.usdc, lent, ready: c.trustUsdc && c.trustAapl && c.aaplAutorise, earnings: Math.max(0, lent - ch.netFourni(evs, me)) }
      : {}),
  })
}

if (chainReady) {
  // Session passkey enregistrée sur cet appareil d'abord, sinon compte Varial déjà autorisé.
  void pk.compteConnu()
    .then((c) => c ?? ch.adresseConnue())
    .then((a) => {
      if (a) patch({ address: a })
      void refresh()
    })
  window.setInterval(() => void refresh(), 10_000)
  // Si l'utilisateur change de compte dans Varial, l'appli suit ce compte.
  ch.suivreCompte((a) => {
    if (chainState.address && !ch.estPasskey(chainState.address) && a !== chainState.address) {
      patch({ address: a, shares: 0, walletShares: 0, debt: 0, lent: 0, usdc: 0, earnings: 0, xlm: 0, ready: false })
      void refresh()
    }
  })
}

/* ---------- Actions (communes aux deux modes) ---------- */

async function tx(label: string, run: () => Promise<string>): Promise<string> {
  patch({ busy: `${label}: ${ch.estPasskey(chainState.address) ? 'confirm with your passkey' : 'sign in Varial'}…` })
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
  if (!chainState.address) throw new Error('Create an account or connect Varial first.')
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
  /** Crée un compte passkey (Face ID, empreinte) : pas d'extension, pas de XLM. */
  async createPasskey(): Promise<string> {
    patch({ busy: 'Creating your account: confirm with Face ID or your fingerprint…' })
    try {
      const a = await pk.creerCompte()
      patch({ address: a })
      await refresh()
      return a
    } finally {
      patch({ busy: null })
    }
  },
  /** Se reconnecte avec une passkey déjà créée sur cet appareil (ou synchronisée). */
  async connectPasskey(): Promise<string> {
    const a = await pk.connecter(true)
    if (!a) throw new Error('No UnlockShares account found for this passkey.')
    patch({ address: a })
    await refresh()
    return a
  },
  disconnect() {
    if (ch.estPasskey(chainState.address)) void pk.deconnecter()
    patch({ address: null, shares: 0, walletShares: 0, debt: 0, lent: 0, usdc: 0, earnings: 0, xlm: 0, ready: false })
  },
  max(kind: Kind, s: AppState): number {
    if (s.mode === 'demo') return demoActions.max(kind)
    const value = s.shares * s.price
    if (kind === 'lend') return s.usdc
    if (kind === 'withdrawLend') return Math.min(s.lent, s.market.cash)
    if (kind === 'deposit') return s.walletShares
    if (kind === 'withdraw') return s.debt ? Math.max(0, s.shares - s.debt / (s.stock.ltvMax * s.price)) : s.shares
    if (kind === 'borrow') {
      // V2 : plafond par adresse (hub : toutes actions confondues) et part max de la caisse par emprunt
      const detteTotale = s.stocks.reduce((n, x) => n + x.debt, 0) || s.debt
      const parAdresse = s.market.capPerAddress === undefined ? Infinity : s.market.capPerAddress - detteTotale
      const parCaisse = s.market.capCashShare === undefined ? s.market.cash : s.market.cash * s.market.capCashShare
      return Math.max(0, Math.min(value * s.stock.ltvMax - s.debt, s.market.cash, parAdresse, parCaisse, s.stock.capLeft))
    }
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
    if (hubMode && kind !== 'lend' && kind !== 'withdrawLend') {
      const j = chainState.stock.jeton
      const hubFn = { deposit: ch.hub.deposer, withdraw: ch.hub.retirer, borrow: ch.hub.emprunter, repay: ch.hub.rembourser }[kind]
      const hash = await tx(`${label} · ${chainState.stock.ticker}`, () => hubFn(me, j, amount))
      return { text: `${label} (${chainState.stock.ticker}) confirmed on Stellar`, hash }
    }
    const hash = await tx(label, () => fn(me, amount))
    return { text: `${label} confirmed on Stellar`, hash }
  },
  async setPrice(price: number): Promise<Done> {
    if (!chainReady) {
      demoActions.setPrice(price)
      return { text: 'Price updated (simulation)' }
    }
    const me = need()
    const st = chainState.stock
    const hash = await tx('New price', () => (hubMode ? ch.hub.fixerPrixDemo(me, st.jeton, price) : ch.pret.fixerPrix(me, price)))
    return { text: `${st.nom} price set to $${price} on Stellar`, hash }
  },
  async liquidate(target?: string, jeton?: string): Promise<Done> {
    if (!chainReady) return { text: `${demoActions.liquidate()} (simulation)` }
    const me = need()
    const hash = await tx('Liquidation', () => (hubMode ? ch.hub.liquider(me, target ?? me, jeton ?? chainState.stock.jeton) : ch.pret.liquider(me, target ?? me)))
    return { text: 'Liquidation confirmed on Stellar', hash }
  },
  async faucet(): Promise<Done> {
    const me = need()
    patch({ busy: 'Preparing…' })
    try {
      const r = await ch.obtenirJetons(me, (t) => patch({ busy: t }))
      await refresh()
      return { text: r.text, hash: r.hash }
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
    const hash = await tx(label, () => (hubMode ? ch.hub.avancerTemps(me, chainState.stock.jeton, days * 86_400) : ch.pret.avancerTemps(me, days * 86_400)))
    return { text: `${days} days of interest applied on Stellar`, hash }
  },
  reset() {
    demoActions.reset()
  },
  /** Hub : choisit l'action sur laquelle portent les boutons (garantie, emprunt, remboursement, démo). */
  selectStock(jeton: string) {
    if (!hubMode) return
    const c = choisir(chainState.stocks, jeton)
    patch({ ...c, market: { ...chainState.market, borrowRate: c.stock?.rate ?? chainState.market.borrowRate, refPrice: c.stock?.refPrice } })
  },
}

export { chainReady, hubMode }
