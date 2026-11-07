// Lecture de la configuration Vite. Aucune valeur secrète ici : tout ce qui commence par VITE_ est public.
export type ApiMode = 'mock' | 'http'

const rawMode = (import.meta.env.VITE_API_MODE ?? 'mock').trim()
const rawUrl = (import.meta.env.VITE_API_URL ?? '').trim()

export const config = {
  /** Mode demandé ; toute valeur autre que "http" retombe sur "mock" */
  apiMode: (rawMode === 'http' ? 'http' : 'mock') as ApiMode,
  /** Valeur brute, pour signaler une configuration invalide à l'écran */
  rawMode,
  apiUrl: rawUrl.replace(/\/+$/, ''),
}

/** Problème de configuration à afficher, ou null si tout va bien */
export function configProblem(): string | null {
  if (config.rawMode !== 'mock' && config.rawMode !== 'http') {
    return `VITE_API_MODE="${config.rawMode}" n'est pas reconnu : le mode simulé est utilisé.`
  }
  if (config.apiMode === 'http' && !config.apiUrl) {
    return 'Mode connecté demandé mais VITE_API_URL est vide.'
  }
  return null
}
