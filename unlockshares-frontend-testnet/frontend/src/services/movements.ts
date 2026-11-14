// Dépôts & retraits : les mouvements d'USDC (Circle) du wallet, lus sur Horizon.
// Analogie : le relevé de compte. Horizon donne toutes les lignes ; on garde l'USDC, on retire les opérations du pool
// (déjà dans l'historique du protocole) et on nomme les guichets qu'on reconnaît (MoneyGram, anchor).
import { chain } from '../chainConfig'
import { horizon } from './chain'

export type Kind = 'mg-out' | 'mg-in' | 'anchor-in'
type Tag = { kind: Kind; ref?: string }
export type Movement = { hash: string; date: Date; dir: 'in' | 'out'; amount: number; other: string; label: string; ref?: string }

const KEY = 'unlockshares.ramps'

const readTags = (): Record<string, Tag> => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, Tag> } catch { return {} }
}

/** Mémorise qu'une transaction vient d'un guichet (pour l'afficher avec son nom). Stockage local au navigateur. */
export function tagTx(hash: string, tag: Tag) {
  try {
    const all = readTags()
    all[hash] = { ...all[hash], ...tag }
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch { /* stockage indisponible : le mouvement s'affichera sans nom de guichet */ }
}

const LABELS: Record<Kind, string> = { 'mg-out': 'Cash out · MoneyGram', 'mg-in': 'Cash in · MoneyGram', 'anchor-in': 'Bank deposit · Stellar anchor' }

type Change = { asset_code?: string; asset_issuer?: string; from?: string; to?: string; amount?: string }
type Rec = { transaction_attr?: { memo_type?: string }; type: string; transaction_hash: string; created_at: string; from?: string; to?: string; amount?: string; asset_code?: string; asset_issuer?: string; asset_balance_changes?: Change[] }

export async function lireMouvements(address: string): Promise<Movement[]> {
  const page = await horizon.payments().forAccount(address).order('desc').limit(100).join('transactions').call()
  const tags = readTags()
  const out: Movement[] = []
  for (const r of page.records as unknown as Rec[]) {
    // Paiement classique, ou transfert via le contrat de l'USDC (invoke_host_function)
    const changes: Change[] = r.type === 'payment' ? [{ asset_code: r.asset_code, asset_issuer: r.asset_issuer, from: r.from, to: r.to, amount: r.amount }] : (r.asset_balance_changes ?? [])
    for (const c of changes) {
      if (c.asset_code !== chain.usdcCode || c.asset_issuer !== chain.emetteurUsdc || !c.amount) continue
      const dir = c.to === address ? 'in' : c.from === address ? 'out' : null
      if (!dir) continue
      const other = (dir === 'in' ? c.from : c.to) ?? ''
      if (other === chain.pret) continue // prêt / emprunt : déjà dans l'historique du protocole
      const t = tags[r.transaction_hash]
      out.push({
        hash: r.transaction_hash,
        date: new Date(r.created_at),
        dir,
        amount: Number(c.amount),
        other,
        // Sans étiquette locale : un envoi avec mémo numérique (Memo.id) = retrait MoneyGram
        label: t ? LABELS[t.kind] : dir === 'out' && r.transaction_attr?.memo_type === 'id' ? LABELS['mg-out'] : dir === 'in' ? 'Received' : 'Sent',
        ref: t?.ref,
      })
    }
  }
  return out
}
