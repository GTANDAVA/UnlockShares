// Off-ramp RÉEL (sandbox) avec le widget MoneyGram Ramps.
// 1. Notre serveur ouvre une session (clé secrète) → 2. le widget MoneyGram s'affiche dans la page
// → 3. quand MoneyGram demande l'USDC, Varial signe le paiement → 4. MoneyGram renvoie un numéro de référence.
// Analogie : le widget est un guichet MoneyGram installé dans notre boutique ; Varial est la signature du client.
import { Asset, BASE_FEE, Memo, Operation, TransactionBuilder } from '@stellar/stellar-sdk'
import { horizon, PASS, signerFreighter } from './chain'

const SDK_URL = 'https://playground.xramps.moneygram.com/sdk/index.global.js' // sandbox
/** USDC de Circle sur testnet (celui que MoneyGram accepte ; faucet.circle.com) */
export const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
export const USDC = new Asset('USDC', USDC_ISSUER)

type SignPayload = { chain?: string; asset?: string; to: string; amount: string; memo?: string | number; tokenAddress?: string; issuer?: string; requiredNetwork?: string }
type Ramps = { open: () => void; close?: () => void; destroy?: () => void }
declare global {
  interface Window {
    RampsSDK?: { createRamps: (o: Record<string, unknown>) => Ramps }
  }
}

let sdk: Promise<void> | null = null
function loadSdk(): Promise<void> {
  if (window.RampsSDK) return Promise.resolve()
  sdk ??= new Promise<void>((ok, ko) => {
    const s = document.createElement('script')
    s.src = SDK_URL
    s.async = true
    s.onload = () => (window.RampsSDK ? ok() : ko(new Error('MoneyGram SDK did not load.')))
    s.onerror = () => { sdk = null; ko(new Error('Cannot load the MoneyGram SDK (network).')) }
    document.head.appendChild(s)
  })
  return sdk
}

async function openSession(address: string): Promise<{ sessionToken: string; widgetUrl: string }> {
  const r = await fetch('/api/moneygram-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ walletAddress: address }) })
  const j = (await r.json().catch(() => ({}))) as { sessionToken?: string; widgetUrl?: string; error?: string }
  if (!r.ok || !j.sessionToken || !j.widgetUrl) throw new Error(j.error ?? `Session refused (${r.status}).`)
  return { sessionToken: j.sessionToken, widgetUrl: j.widgetUrl }
}

/** Paiement USDC demandé par MoneyGram, signé par Varial, soumis à Horizon. Renvoie le hash. */
async function pay(address: string, p: SignPayload): Promise<string> {
  if (p.requiredNetwork && p.requiredNetwork !== 'testnet') throw new Error(`MoneyGram asks for ${p.requiredNetwork}, the app runs on testnet.`)
  if ((p.asset ?? 'USDC') !== 'USDC') throw new Error(`Unsupported asset ${p.asset}.`)
  const memo = p.memo === undefined || p.memo === null || String(p.memo).trim() === '' ? null : String(p.memo).trim()
  if (memo !== null && !/^\d+$/.test(memo)) throw new Error('MoneyGram memo must be numeric.')
  const src = await horizon.loadAccount(address)
  // Doc MoneyGram : tokenAddress = code de l'actif (USDC) ; issuer du payload en priorité, sinon l'émetteur Circle testnet.
  let b = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: PASS })
    .addOperation(Operation.payment({ destination: p.to, asset: new Asset(p.tokenAddress || 'USDC', p.issuer || USDC_ISSUER), amount: p.amount }))
    .setTimeout(180)
  if (memo !== null) b = b.addMemo(Memo.id(memo)) // OBLIGATOIRE : sans lui MoneyGram ne retrouve pas le retrait
  const signed = await signerFreighter(b.build(), address)
  const res = await horizon.submitTransaction(signed)
  return res.hash
}

export type Handlers = { onComplete: (ref: string) => void; onError: (msg: string) => void; onPaid?: (hash: string) => void }

export type RampMode = 'off-ramp' | 'on-ramp'

/** Ouvre le widget MoneyGram dans `container` : off-ramp (USDC → espèces) ou on-ramp (espèces → USDC). Renvoie une fonction de fermeture. */
export async function openMoneyGram(container: HTMLElement, address: string, h: Handlers, mode: RampMode = 'off-ramp'): Promise<() => void> {
  const [session] = await Promise.all([openSession(address), loadSdk()])
  // Doc MoneyGram : remplacer le paramètre mode de widgetUrl (ne pas en ajouter un second), et le répéter dans createRamps.
  const url = new URL(session.widgetUrl)
  url.searchParams.set('mode', mode)
  const ramps = window.RampsSDK!.createRamps({
    container,
    sessionToken: session.sessionToken,
    widgetUrl: url.toString(),
    mode,
    ...(mode === 'on-ramp' ? { transaction: { type: 'on-ramp' } } : {}),
    wallet: { address, chain: 'stellar', asset: 'USDC', walletType: 'non-custodial' },
    onSignTransaction: async (tx: SignPayload) => {
      const hash = await pay(address, tx)
      h.onPaid?.(hash)
      return hash
    },
    onComplete: (r: { referenceNumber?: string }) => h.onComplete(r?.referenceNumber ?? ''),
    onError: (e: unknown) => h.onError(e instanceof Error ? e.message : typeof e === 'string' ? e : 'MoneyGram widget error.'),
  })
  ramps.open()
  return () => { ramps.close?.(); ramps.destroy?.() }
}

/** Solde USDC (Circle) du compte ; null = pas encore de ligne de confiance */
export async function usdcBalance(address: string): Promise<number | null> {
  const acc = await horizon.loadAccount(address)
  const b = acc.balances.find((x) => 'asset_code' in x && x.asset_code === 'USDC' && x.asset_issuer === USDC_ISSUER)
  return b ? Number(b.balance) : null
}

/** Ajoute la ligne de confiance USDC (Circle) : autorise le compte à détenir ce jeton */
export async function addUsdcTrustline(address: string): Promise<string> {
  const src = await horizon.loadAccount(address)
  const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: PASS }).addOperation(Operation.changeTrust({ asset: USDC })).setTimeout(180).build()
  const res = await horizon.submitTransaction(await signerFreighter(tx, address))
  return res.hash
}
