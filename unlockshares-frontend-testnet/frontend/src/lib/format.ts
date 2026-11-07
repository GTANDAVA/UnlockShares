// Mise en forme uniquement (centimes -> euros, bps -> %), aucune règle de risque.
const eurFmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })
const pctFmt = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** 12345 -> "123,45 €" ; division entière pour éviter les erreurs d'arrondi des flottants */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const euros = Math.trunc(abs / 100)
  const rest = abs % 100
  return sign + eurFmt.format(Number(`${euros}.${String(rest).padStart(2, '0')}`))
}

/** 5000 -> "50,00 %" */
export function formatBpsPercent(bps: number): string {
  return `${pctFmt.format(bps / 100)} %`
}

/** 15200 -> "1,52" ; null -> null (affiché "non applicable" par la page) */
export function formatHealthFactor(bps: number | null): string | null {
  return bps === null ? null : pctFmt.format(bps / 10000)
}

/**
 * Saisie en euros ("100", "100,5", "1 234,56") -> centimes entiers.
 * Retourne null si la saisie n'est pas un montant valide (au plus 2 décimales, positif ou nul).
 */
export function parseEurosToCents(input: string): number | null {
  const s = input.replace(/\s| /g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const [ent, dec = ''] = s.split('.')
  const cents = Number(ent) * 100 + Number(dec.padEnd(2, '0'))
  return Number.isSafeInteger(cents) ? cents : null
}

/** Centimes -> texte de saisie "100,00" (pour charger un exemple dans le formulaire) */
export function centsToInput(cents: number): string {
  return `${Math.trunc(cents / 100)},${String(cents % 100).padStart(2, '0')}`
}
