// Off-ramp réel sur testnet avec l'anchor de référence de la Stellar Development Foundation.
// SEP-1 (stellar.toml) → SEP-10 (connexion signée Varial) → SEP-24 (retrait interactif) → paiement vers l'anchor.
// Analogie : l'anchor est le bureau de change. SEP-10 = montrer sa pièce d'identité, SEP-24 = remplir le bordereau au guichet.
import { Asset, BASE_FEE, Memo, Operation, StellarToml, TransactionBuilder, WebAuth, type Transaction } from '@stellar/stellar-sdk'
import { horizon, PASS, signerFreighter } from './chain'

export const ANCHOR_DOMAIN = 'testanchor.stellar.org'

export type AnchorAsset = { code: 'native' | 'USDC' | 'SRT'; label: string; asset: Asset }

export type Sep24Tx = {
  id: string
  status: string
  amount_in?: string
  amount_out?: string
  amount_fee?: string
  withdraw_anchor_account?: string
  withdraw_memo?: string
  withdraw_memo_type?: 'text' | 'id' | 'hash'
  stellar_transaction_id?: string
  more_info_url?: string
  message?: string
}

type Toml = { auth: string; sep24: string; signingKey: string; assets: AnchorAsset[] }

let tomlCache: Toml | null = null

/** SEP-1 : l'annuaire public de l'anchor (adresses de ses services et actifs acceptés) */
export async function lireToml(): Promise<Toml> {
  if (tomlCache) return tomlCache
  const t = await StellarToml.Resolver.resolve(ANCHOR_DOMAIN)
  if (!t.WEB_AUTH_ENDPOINT || !t.TRANSFER_SERVER_SEP0024 || !t.SIGNING_KEY) throw new Error('The anchor does not publish SEP-10 / SEP-24.')
  const assets: AnchorAsset[] = [{ code: 'native', label: 'XLM', asset: Asset.native() }]
  for (const c of t.CURRENCIES ?? []) {
    if ((c.code === 'USDC' || c.code === 'SRT') && c.issuer) assets.push({ code: c.code, label: c.code, asset: new Asset(c.code, c.issuer) })
  }
  tomlCache = { auth: t.WEB_AUTH_ENDPOINT, sep24: t.TRANSFER_SERVER_SEP0024, signingKey: t.SIGNING_KEY, assets }
  return tomlCache
}

const tokens = new Map<string, string>()

/** SEP-10 : l'anchor envoie un « défi » (transaction non soumise), Varial le signe, l'anchor rend un jeton de session */
export async function connexionAnchor(account: string): Promise<string> {
  const known = tokens.get(account)
  if (known) return known
  const toml = await lireToml()
  const r = await fetch(`${toml.auth}?account=${encodeURIComponent(account)}`)
  if (!r.ok) throw new Error(`Anchor sign-in refused (${r.status}).`)
  const { transaction } = (await r.json()) as { transaction: string }
  // Vérifie que le défi vient bien de l'anchor et ne contient rien de dangereux avant de le signer.
  const { tx } = WebAuth.readChallengeTx(transaction, toml.signingKey, PASS, ANCHOR_DOMAIN, new URL(toml.auth).host)
  const signed = await signerFreighter(tx as Transaction, account)
  const p = await fetch(toml.auth, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transaction: signed.toXDR() }) })
  const j = (await p.json()) as { token?: string; error?: string }
  if (!p.ok || !j.token) throw new Error(j.error ?? 'Anchor sign-in failed.')
  tokens.set(account, j.token)
  return j.token
}

/** SEP-24 : ouvre un retrait interactif. Renvoie l'adresse de la page de l'anchor et l'identifiant du retrait. */
export async function demarrerRetrait(account: string, code: AnchorAsset['code']): Promise<{ url: string; id: string }> {
  const toml = await lireToml()
  const token = await connexionAnchor(account)
  const r = await fetch(`${toml.sep24}/transactions/withdraw/interactive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ asset_code: code, account, lang: 'en' }),
  })
  const j = (await r.json()) as { url?: string; id?: string; error?: string }
  if (r.status === 403) tokens.delete(account)
  if (!r.ok || !j.url || !j.id) throw new Error(j.error ?? `Withdrawal refused by the anchor (${r.status}).`)
  return { url: j.url, id: j.id }
}

/** SEP-24 : état du retrait côté anchor */
export async function lireRetrait(account: string, id: string): Promise<Sep24Tx> {
  const toml = await lireToml()
  const token = await connexionAnchor(account)
  const r = await fetch(`${toml.sep24}/transaction?id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } })
  const j = (await r.json()) as { transaction?: Sep24Tx; error?: string }
  if (!r.ok || !j.transaction) throw new Error(j.error ?? `Cannot read the withdrawal (${r.status}).`)
  return j.transaction
}

function memo(t: Sep24Tx): Memo {
  if (!t.withdraw_memo) return Memo.none()
  if (t.withdraw_memo_type === 'id') return Memo.id(t.withdraw_memo)
  if (t.withdraw_memo_type === 'hash') return Memo.hash([...atob(t.withdraw_memo)].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(''))
  return Memo.text(t.withdraw_memo)
}

/** Dernière étape : envoyer les fonds à l'anchor, avec le mémo qui identifie ce retrait. Renvoie le hash. */
export async function payerAnchor(account: string, t: Sep24Tx, asset: Asset): Promise<string> {
  if (!t.withdraw_anchor_account || !t.amount_in) throw new Error('The anchor has not given its payment details yet.')
  const src = await horizon.loadAccount(account)
  const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: PASS })
    .addOperation(Operation.payment({ destination: t.withdraw_anchor_account, asset, amount: Number(t.amount_in).toFixed(7) }))
    .addMemo(memo(t))
    .setTimeout(180)
    .build()
  const signed = await signerFreighter(tx, account)
  const res = await horizon.submitTransaction(signed)
  return res.hash
}

/** Solde d'un actif sur le compte (null = pas de ligne de confiance) */
export async function solde(account: string, a: Asset): Promise<number | null> {
  const acc = await horizon.loadAccount(account)
  for (const b of acc.balances) {
    if (a.isNative() && b.asset_type === 'native') return Number(b.balance)
    if ('asset_code' in b && b.asset_code === a.getCode() && b.asset_issuer === a.getIssuer()) return Number(b.balance)
  }
  return null
}
