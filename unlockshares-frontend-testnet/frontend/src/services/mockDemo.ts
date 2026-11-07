// Données de démonstration de Léa, reprises de la maquette V3.
// Ce module joue le rôle d'un backend simulé : les pages ne font qu'afficher ce qu'il renvoie.
// Aucune transaction n'est envoyée, aucun portefeuille n'est connecté.
// À remplacer par de vraies routes backend quand elles existeront (positions, pool, taux, historique).

export const DEMO = {
  /** Emprunt maximum : 50 % de la valeur des actions */
  ltvMax: 0.5,
  /** Vente de protection (liquidation) à 80 % */
  liquidation: 0.8,
  /** Taux d'emprunt annuel affiché (5,5 %) */
  borrowRate: 0.055,
  /** Rendement prêteur affiché : 5,5 % × 76 % du pool utilisé ≈ 4,2 % */
  lendRate: 0.042,
  lendRateLabel: '4,2 %',
  borrowRateLabel: '5,5 %',
  poolUsed: 0.76,
  poolDeposits: '1,20 M USDC',
  totalLoans: '912 k USDC',
  earnings: '1,15 USDC',
}

export type DemoEvent = { date: string; action: string; amount: string }

export type DemoState = {
  /** Actions Apple déposées en garantie */
  shares: number
  /** Actions Apple restées dans le portefeuille */
  walletShares: number
  /** Dette en USDC */
  debt: number
  /** USDC prêtés au pool */
  lent: number
  /** USDC disponibles */
  usdc: number
  /** Intérêts gagnés sur ce qui est prêté */
  earnings: number
  /** Prix d'une action Apple (oracle de démo) */
  price: number
  history: DemoEvent[]
}

export type Zone = { label: string; cls: 's-safe' | 's-watch' | 's-danger'; color: string }

const INITIAL: DemoState = {
  shares: 50,
  walletShares: 10,
  debt: 3000,
  lent: 1000,
  usdc: 2000,
  earnings: 1.15,
  price: 200,
  history: [
    { date: '24 Oct 14:02', action: 'Deposit shares', amount: '50 AAPL' },
    { date: '24 Oct 14:05', action: 'Borrow', amount: '3 000 USDC' },
    { date: '24 Oct 14:09', action: 'Lend', amount: '1 000 USDC' },
  ],
}

let state: DemoState = structuredClone(INITIAL)
const listeners = new Set<() => void>()
const set = (next: DemoState) => {
  state = next
  listeners.forEach((l) => l())
}

export const demoStore = {
  subscribe(l: () => void) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
  get: () => state,
}

/** Valeurs dérivées affichées par les pages (calculées ici, pas dans l'interface). */
export function derive(s: DemoState) {
  const value = s.shares * s.price
  const ltv = value ? s.debt / value : 0
  const available = Math.max(0, value * DEMO.ltvMax - s.debt)
  // Marge jusqu'à la vente de protection (80 %), au-delà de ce qui reste empruntable.
  const cushion = Math.max(0, value * DEMO.liquidation - s.debt - available)
  return {
    value,
    ltv,
    available,
    cushion,
    net: value - s.debt,
    balance: value - s.debt + s.lent + s.usdc,
    /** Part de la limite utilisée (LTV / 80 %) */
    usedPct: Math.round((ltv / DEMO.liquidation) * 100),
    maxBorrowPct: (DEMO.ltvMax / DEMO.liquidation) * 100,
    safetyPrice: s.shares ? s.debt / (s.shares * DEMO.liquidation) : 0,
    monthlyCost: (s.debt * DEMO.borrowRate) / 12,
    liquidable: s.debt > 0 && ltv > DEMO.liquidation,
    zone: zoneOf(ltv),
  }
}

export function zoneOf(ltv: number): Zone {
  if (ltv >= 0.7) return { label: 'Danger', cls: 's-danger', color: 'var(--danger)' }
  if (ltv >= 0.5) return { label: 'Watch', cls: 's-watch', color: 'var(--watch)' }
  return { label: 'Safe', cls: 's-safe', color: 'var(--safe)' }
}

/** LTV qu'aurait la position après un changement de dette (aperçu dans les fenêtres). */
export const ltvWithDebt = (s: DemoState, debt: number) => (s.shares * s.price ? debt / (s.shares * s.price) : 0)

const usdc = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} USDC`
const now = () => new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(',', '')
const log = (s: DemoState, action: string, amount: string) => [...s.history, { date: now(), action, amount }]

export type DemoAction = 'lend' | 'withdrawLend' | 'deposit' | 'withdraw' | 'borrow' | 'repay'

export const demoActions = {
  max(kind: DemoAction, s = state) {
    if (kind === 'lend') return s.usdc
    if (kind === 'withdrawLend') return s.lent
    if (kind === 'deposit') return s.walletShares
    if (kind === 'withdraw') return Math.max(0, Math.floor(s.shares - s.debt / (DEMO.ltvMax * s.price)))
    if (kind === 'borrow') return Math.max(0, Math.floor(derive(s).value * DEMO.ltvMax - s.debt))
    return Math.min(s.debt, s.usdc)
  },
  run(kind: DemoAction, amount: number): string {
    const s = state
    if (!(amount > 0) || amount > demoActions.max(kind)) throw new Error('Amount out of range.')
    if (kind === 'lend') {
      set({ ...s, usdc: s.usdc - amount, lent: s.lent + amount, history: log(s, 'Lend', usdc(amount)) })
      return `Lent ${usdc(amount)}`
    }
    if (kind === 'withdrawLend') {
      set({ ...s, usdc: s.usdc + amount, lent: s.lent - amount, history: log(s, 'Withdraw from pool', usdc(amount)) })
      return `Withdrew ${usdc(amount)}`
    }
    if (kind === 'deposit') {
      set({ ...s, walletShares: s.walletShares - amount, shares: s.shares + amount, history: log(s, 'Deposit shares', `${amount} AAPL`) })
      return `Deposited ${amount} AAPL`
    }
    if (kind === 'withdraw') {
      set({ ...s, walletShares: s.walletShares + amount, shares: s.shares - amount, history: log(s, 'Withdraw shares', `${amount} AAPL`) })
      return `Withdrew ${amount} AAPL`
    }
    if (kind === 'borrow') {
      set({ ...s, debt: s.debt + amount, usdc: s.usdc + amount, history: log(s, 'Borrow', usdc(amount)) })
      return `Borrowed ${usdc(amount)}`
    }
    set({ ...s, debt: s.debt - amount, usdc: s.usdc - amount, history: log(s, 'Pay back', usdc(amount)) })
    return `Paid back ${usdc(amount)}`
  },
  setPrice(price: number) {
    set({ ...state, price })
  },
  /** Fait passer `days` jours d'un coup (intérêts simples, comme le contrat) */
  skipDays(days: number): string {
    const s = state
    const f = days / 365
    const interest = s.debt * DEMO.borrowRate * f
    const gain = s.lent * DEMO.lendRate * f
    set({ ...s, debt: s.debt + interest, lent: s.lent + gain, earnings: s.earnings + gain, history: log(s, 'Time jump (demo)', `+${days} days`) })
    return `${days} days later: +${usdc(interest)} of debt, +${usdc(gain)} earned`
  },
  liquidate(): string {
    const s = state
    if (!derive(s).liquidable) throw new Error('This position cannot be liquidated.')
    set({ ...s, shares: 0, debt: 0, history: log(s, 'Protection sale by liquidator', `${s.shares} AAPL for ${usdc(s.debt)}`) })
    return 'Liquidation'
  },
  reset() {
    set(structuredClone(INITIAL))
  },
}
