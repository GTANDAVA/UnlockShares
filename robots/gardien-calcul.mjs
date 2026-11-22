// Calcul du robot gardien, sans réseau (testé dans gardien-calcul.test.mjs).
// Règle : si un prêt atteint le seuil d'alerte, on rembourse de quoi ramener la dette à la cible,
// sans dépasser ni le reste du plafond du jour, ni l'USDC disponible dans le portefeuille.

/** Le gardien agit à partir de ce niveau (7000 = 70 % de la valeur des actions, la liquidation est à 80 %). */
export const ALERTE_BPS = 7000n
/** Il ramène la dette à ce niveau (6000 = 60 %). */
export const CIBLE_BPS = 6000n
/** En dessous de ce montant (0,01 USDC, 7 décimales), on ne fait rien. */
export const MINIMUM = 100_000n

/** Ce qui reste du plafond pour la période en cours (fenêtre fixe, comme dans contracts/gardien). */
export function restePlafond(etat, periode, ledger) {
  if (!etat) return 0n
  if (ledger >= etat.debut + periode) return etat.plafond
  const r = etat.plafond - etat.depense
  return r > 0n ? r : 0n
}

/**
 * Choisit UN remboursement pour ce compte (le prêt le plus risqué d'abord), ou null.
 * positions : sortie de hub.positions(compte) ; reste : plafond restant ; solde : USDC du portefeuille.
 */
export function choisirRemboursement(positions, reste, solde) {
  const aSauver = positions
    .filter((p) => p.dette > 0n && p.valeur > 0n && p.ltv_bps >= ALERTE_BPS)
    .sort((a, b) => (b.ltv_bps > a.ltv_bps ? 1 : b.ltv_bps < a.ltv_bps ? -1 : 0))
  const p = aSauver[0]
  if (!p) return null
  const besoin = p.dette - (p.valeur * CIBLE_BPS) / 10_000n
  let montant = besoin
  if (montant > reste) montant = reste
  if (montant > solde) montant = solde
  if (montant < MINIMUM) return { jeton: p.jeton, montant: 0n, besoin, ltv_bps: p.ltv_bps, raison: besoin > reste ? 'plafond du jour atteint' : 'pas assez d’USDC dans le portefeuille' }
  return { jeton: p.jeton, montant, besoin, ltv_bps: p.ltv_bps }
}

/** Hub v2 : un jour = 17 280 ledgers (comme dans le hub). */
export const JOUR = 17_280

/** Hub v2 : ce qui reste du plafond du jour d'un mandat (le hub repart de zéro chaque jour). */
export function restePlafondMandat(mandat, ledger) {
  if (!mandat) return 0n
  if (Math.floor(ledger / JOUR) !== Number(mandat.jour)) return mandat.plafond_jour
  const r = mandat.plafond_jour - mandat.verse
  return r > 0n ? r : 0n
}
