// Types conformes au contrat d'API UnlockShares (backend Rust).
// Montants en centimes (entiers), ratios en points de base (1 bps = 0,01 %).

/** Requête POST /risk/evaluate */
export interface EvaluateRequest {
  collateral_quantity: number
  collateral_price_cents: number
  debt_cents: number
}

/**
 * Niveau de risque renvoyé par le backend.
 * Le contrat ne montre que "healthy" : les autres valeurs possibles ne sont pas documentées,
 * on garde donc string pour afficher proprement une valeur inconnue.
 */
export type RiskLevel = 'healthy' | (string & {})

/** Réponse POST /risk/evaluate */
export interface EvaluateResponse {
  collateral_value_cents: number
  debt_cents: number
  ltv_bps: number
  risk_level: RiskLevel
  opening_allowed: boolean
  /** null quand il n'y a pas de dette (le Health Factor n'a pas de sens) */
  health_factor_bps: number | null
}

/** Requête POST /risk/liquidation-quote */
export interface LiquidationQuoteRequest {
  collateral_quantity: number
  collateral_price_cents: number
  debt_cents: number
  repayment_cents: number
}

/** Réponse POST /risk/liquidation-quote */
export interface LiquidationQuoteResponse {
  repayment_cents: number
  bonus_cents: number
  collateral_seized_cents: number
  remaining_debt_cents: number
  remaining_collateral_cents: number
}

/** Corps d'une erreur métier (exemple du contrat : statut 442) */
export interface ApiErrorBody {
  message: string
}
