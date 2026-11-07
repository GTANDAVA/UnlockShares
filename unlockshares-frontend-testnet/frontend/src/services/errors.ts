// Erreur unique remontée par les services, pour que chaque page affiche un message clair.
export type RiskApiErrorKind =
  | 'business' // le backend refuse (ex. statut 442 avec { message })
  | 'http' // autre statut HTTP en erreur
  | 'network' // backend injoignable, délai dépassé
  | 'unexpected' // réponse qui ne respecte pas le contrat
  | 'config' // configuration VITE_ incomplète
  | 'mock-unavailable' // aucun scénario simulé pour ces valeurs

export class RiskApiError extends Error {
  readonly kind: RiskApiErrorKind
  readonly status?: number

  constructor(kind: RiskApiErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'RiskApiError'
    this.kind = kind
    this.status = status
  }
}
