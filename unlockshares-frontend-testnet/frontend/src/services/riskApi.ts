// Point d'entrée unique des appels réseau. Les pages n'appellent que riskApi.
import { config, configProblem } from '../config'
import type {
  EvaluateRequest,
  EvaluateResponse,
  LiquidationQuoteRequest,
  LiquidationQuoteResponse,
} from '../types/api'
import { RiskApiError } from './errors'
import { mockRiskApi } from './mockRiskApi'
import { errorMessageOf, isEvaluateResponse, isLiquidationQuoteResponse } from './validate'

const TIMEOUT_MS = 10_000

async function postJson<T>(path: string, body: unknown, isValid: (v: unknown) => v is T): Promise<T> {
  if (!config.apiUrl) throw new RiskApiError('config', configProblem() ?? 'VITE_API_URL est vide.')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`${config.apiUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === 'AbortError'
    throw new RiskApiError(
      'network',
      timedOut ? 'Le serveur ne répond pas (délai dépassé).' : 'Impossible de joindre le serveur. Vérifiez VITE_API_URL et que le backend tourne.',
    )
  } finally {
    clearTimeout(timer)
  }

  let data: unknown = null
  const text = await res.text()
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      throw new RiskApiError('unexpected', `Réponse illisible du serveur (statut ${res.status}).`, res.status)
    }
  }

  if (!res.ok) {
    const msg = errorMessageOf(data)
    // Le contrat donne un exemple d'erreur métier avec { message } (statut 442)
    if (msg && res.status >= 400 && res.status < 500) throw new RiskApiError('business', msg, res.status)
    throw new RiskApiError('http', msg ?? `Erreur du serveur (statut ${res.status}).`, res.status)
  }
  if (!isValid(data)) {
    throw new RiskApiError('unexpected', 'La réponse du serveur ne correspond pas au contrat d’API.', res.status)
  }
  return data
}

const httpRiskApi = {
  evaluate: (req: EvaluateRequest) => postJson<EvaluateResponse>('/risk/evaluate', req, isEvaluateResponse),
  liquidationQuote: (req: LiquidationQuoteRequest) =>
    postJson<LiquidationQuoteResponse>('/risk/liquidation-quote', req, isLiquidationQuoteResponse),
}

/** Service choisi selon VITE_API_MODE */
export const riskApi = config.apiMode === 'http' ? httpRiskApi : mockRiskApi
export const apiMode = config.apiMode
