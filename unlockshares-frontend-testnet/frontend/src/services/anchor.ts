// Off-ramp réel sur testnet avec l'anchor de référence de la Stellar Development Foundation.
// SEP-1 (stellar.toml) → SEP-10 (connexion signée Varial) ou SEP-45 (compte passkey C…) → SEP-24 (formulaire interactif) → paiement.
// Analogie : l'anchor est le bureau de change. SEP-10 = montrer sa pièce d'identité, SEP-24 = remplir le bordereau au guichet.
import { Account, Asset, BASE_FEE, Memo, MuxedAccount, Operation, StellarToml, TransactionBuilder, WebAuth, type Transaction } from '@stellar/stellar-sdk'
import { estPasskey, horizon, PASS, signerFreighter, toUnits, transfererPasskey } from './chain'
import { signerAutorisation } from './passkey'
import { encoderReponse, verifierDefi } from './sep45Defi'

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

type Toml = { auth: string; sep24: string; signingKey: string; assets: AnchorAsset[]; authContrats?: string; contratAuth?: string }

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
  // SEP-45 (facultatif) : connexion des comptes intelligents C…
  const ext = t as Record<string, unknown>
  const authContrats = typeof ext.WEB_AUTH_FOR_CONTRACTS_ENDPOINT === 'string' ? ext.WEB_AUTH_FOR_CONTRACTS_ENDPOINT : undefined
  const contratAuth = typeof ext.WEB_AUTH_CONTRACT_ID === 'string' ? ext.WEB_AUTH_CONTRACT_ID : undefined
  tomlCache = { auth: t.WEB_AUTH_ENDPOINT, sep24: t.TRANSFER_SERVER_SEP0024, signingKey: t.SIGNING_KEY, assets, authContrats, contratAuth }
  return tomlCache
}

const tokens = new Map<string, string>()

/** SEP-10 : l'anchor envoie un « défi » (transaction non soumise), Varial le signe, l'anchor rend un jeton de session */
export async function connexionAnchor(account: string): Promise<string> {
  const known = tokens.get(account)
  if (known) return known
  const toml = await lireToml()
  if (estPasskey(account)) return connexionAnchorPasskey(account, toml)
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

/**
 * SEP-45 : même idée que SEP-10, pour un compte passkey (adresse C…). L'anchor envoie une autorisation à signer
 * (appel à son contrat web_auth_verify, jamais soumis au réseau). On la vérifie, la passkey la signe, l'anchor rend un jeton.
 */
async function connexionAnchorPasskey(account: string, toml: Toml): Promise<string> {
  if (!toml.authContrats || !toml.contratAuth) throw new Error('This anchor does not support passkey accounts yet (SEP-45).')
  const r = await fetch(`${toml.authContrats}?account=${encodeURIComponent(account)}&home_domain=${encodeURIComponent(ANCHOR_DOMAIN)}`)
  // La spec écrit authorization_entries ; testanchor (Anchor Platform) répond en camelCase (authorizationEntries) : on accepte les deux.
  const c = (await r.json().catch(() => ({}))) as { authorization_entries?: string; authorizationEntries?: string; network_passphrase?: string; networkPassphrase?: string; error?: string }
  const entrees = c.authorization_entries ?? c.authorizationEntries
  const reseau = c.network_passphrase ?? c.networkPassphrase
  if (!r.ok || !entrees) throw new Error(c.error ?? `Anchor sign-in refused (${r.status}).`)
  if (reseau && reseau !== PASS) throw new Error('The anchor is on another network.')
  // Contrôle complet avant toute signature (contrat, fonction, domaines, compte, signature de l'anchor).
  const defi = verifierDefi(entrees, {
    account, homeDomain: ANCHOR_DOMAIN, webAuthDomain: new URL(toml.authContrats).host, contrat: toml.contratAuth, cleServeur: toml.signingKey, passphrase: PASS,
  })
  const signee = await signerAutorisation(defi.entrees[defi.indexClient].toXdr('base64'), defi.expiration, 1)
  // Envoi en formulaire : le format que la spec et Anchor Platform lisent tous deux sous le nom authorization_entries.
  const p = await fetch(toml.authContrats, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ authorization_entries: encoderReponse(defi, signee) }) })
  const j = (await p.json().catch(() => ({}))) as { token?: string; error?: string }
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

/** SEP-24 : ouvre un DÉPÔT interactif (on-ramp : banque → actif Stellar). Renvoie l'adresse du formulaire de l'anchor et l'identifiant. */
export async function demarrerDepot(account: string, code: AnchorAsset['code'], amount?: string): Promise<{ url: string; id: string }> {
  const toml = await lireToml()
  const token = await connexionAnchor(account)
  const r = await fetch(`${toml.sep24}/transactions/deposit/interactive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ asset_code: code, account, lang: 'en', ...(amount ? { amount } : {}) }),
  })
  const j = (await r.json()) as { url?: string; id?: string; error?: string }
  if (r.status === 403) tokens.delete(account)
  if (!r.ok || !j.url || !j.id) throw new Error(j.error ?? `Deposit refused by the anchor (${r.status}).`)
  return { url: j.url, id: j.id }
}

/** SEP-24 : état d'une transaction (dépôt ou retrait) côté anchor */
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
  if (estPasskey(account)) return payerAnchorPasskey(account, t, asset)
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

/**
 * Compte passkey : un appel de contrat n'a pas de mémo. On envoie donc les USDC à l'adresse « M… » de l'anchor
 * (son adresse G… + le numéro du retrait) : l'anchor lit ce numéro dans l'événement du transfert (CAP-67).
 */
async function payerAnchorPasskey(account: string, t: Sep24Tx, asset: Asset): Promise<string> {
  let dest = t.withdraw_anchor_account!
  if (t.withdraw_memo) {
    if (t.withdraw_memo_type !== 'id') throw new Error('This anchor asks for a text memo: not possible from a passkey account yet.')
    dest = new MuxedAccount(new Account(dest, '0'), t.withdraw_memo).accountId()
  }
  return transfererPasskey(account, asset.contractId(PASS), dest, toUnits(Number(t.amount_in)))
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
