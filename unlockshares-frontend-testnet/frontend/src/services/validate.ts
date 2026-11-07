// Vérifie que les réponses respectent la forme du contrat (pas de calcul métier ici).
import type { EvaluateResponse, LiquidationQuoteResponse } from '../types/api'

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function isEvaluateResponse(v: unknown): v is EvaluateResponse {
  return (
    isObj(v) &&
    isInt(v.collateral_value_cents) &&
    isInt(v.debt_cents) &&
    isInt(v.ltv_bps) &&
    typeof v.risk_level === 'string' &&
    typeof v.opening_allowed === 'boolean' &&
    (v.health_factor_bps === null || isInt(v.health_factor_bps))
  )
}

export function isLiquidationQuoteResponse(v: unknown): v is LiquidationQuoteResponse {
  return (
    isObj(v) &&
    isInt(v.repayment_cents) &&
    isInt(v.bonus_cents) &&
    isInt(v.collateral_seized_cents) &&
    isInt(v.remaining_debt_cents) &&
    isInt(v.remaining_collateral_cents)
  )
}

export function errorMessageOf(v: unknown): string | null {
  return isObj(v) && typeof v.message === 'string' && v.message.trim() ? v.message : null
}
