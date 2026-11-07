// Données simulées : réponses figées, sans aucun calcul de risque.
// Un scénario = une requête exacte et la réponse que le backend renverrait.
// Pour ajouter un scénario, ajoute une entrée dans le tableau correspondant.
import type {
  EvaluateRequest,
  EvaluateResponse,
  LiquidationQuoteRequest,
  LiquidationQuoteResponse,
} from '../types/api'
import { RiskApiError } from './errors'

export interface MockScenario<Req, Res> {
  id: string
  label: string
  /** Origine des valeurs, affichée pour éviter toute confusion */
  source: 'contrat' | 'hypothèse à valider'
  request: Req
  response?: Res
  /** Erreur métier simulée à la place d'une réponse */
  error?: { status: number; message: string }
}

export const evaluateScenarios: MockScenario<EvaluateRequest, EvaluateResponse>[] = [
  {
    id: 'sain',
    label: 'Position saine (brief)',
    source: 'contrat',
    request: { collateral_quantity: 10, collateral_price_cents: 10000, debt_cents: 50000 },
    response: {
      collateral_value_cents: 100000,
      debt_cents: 50000,
      ltv_bps: 5000,
      risk_level: 'healthy',
      opening_allowed: true,
      health_factor_bps: 15200,
    },
  },
  {
    id: 'sans-dette',
    label: 'Sans dette',
    // Le contrat ne fournit pas cet exemple : valeurs à confirmer avec le backend.
    source: 'hypothèse à valider',
    request: { collateral_quantity: 10, collateral_price_cents: 10000, debt_cents: 0 },
    response: {
      collateral_value_cents: 100000,
      debt_cents: 0,
      ltv_bps: 0,
      risk_level: 'healthy',
      opening_allowed: true,
      health_factor_bps: null,
    },
  },
]

export const liquidationScenarios: MockScenario<LiquidationQuoteRequest, LiquidationQuoteResponse>[] = [
  {
    id: 'devis-brief',
    label: 'Devis de liquidation (brief)',
    source: 'contrat',
    request: { collateral_quantity: 10, collateral_price_cents: 6570, debt_cents: 50000, repayment_cents: 27300 },
    response: {
      repayment_cents: 27300,
      bonus_cents: 1365,
      collateral_seized_cents: 28665,
      remaining_debt_cents: 22700,
      remaining_collateral_cents: 37035,
    },
  },
]

const sameRequest = (a: object, b: object) =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.entries(a).every(([k, v]) => (b as Record<string, unknown>)[k] === v)

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function answer<Req extends object, Res>(list: MockScenario<Req, Res>[], req: Req): Promise<Res> {
  await delay(350)
  const s = list.find((x) => sameRequest(x.request, req))
  if (!s) {
    throw new RiskApiError(
      'mock-unavailable',
      "Aucun scénario simulé pour ces valeurs. Chargez un exemple ou passez en mode connecté.",
    )
  }
  if (s.error) throw new RiskApiError('business', s.error.message, s.error.status)
  return structuredClone(s.response as Res)
}

export const mockRiskApi = {
  evaluate: (req: EvaluateRequest) => answer(evaluateScenarios, req),
  liquidationQuote: (req: LiquidationQuoteRequest) => answer(liquidationScenarios, req),
}
