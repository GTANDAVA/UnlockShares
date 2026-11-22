// État du gardien partagé entre la carte « Guardian » et la jauge de l'accueil, et ses seuils.
// Les seuils sont ceux du robot (robots/gardien-calcul.mjs), dans la MÊME règle que l'écran : % de la valeur des actions.
import { useSyncExternalStore } from 'react'

/** Le gardien agit dès que la dette atteint 70 % de la valeur des actions (= début de la zone « Danger »). */
export const ALERTE_GARDIEN = 0.7
/** Il rembourse de quoi revenir à 60 %. */
export const CIBLE_GARDIEN = 0.6

let actif = false
const abonnes = new Set<() => void>()

export function fixerGardienActif(v: boolean) {
  if (v === actif) return
  actif = v
  abonnes.forEach((f) => f())
}

export const useGardienActif = () =>
  useSyncExternalStore(
    (f) => { abonnes.add(f); return () => abonnes.delete(f) },
    () => actif,
  )
