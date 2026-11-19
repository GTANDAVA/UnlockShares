// Recharge en USDC de Circle (testnet) : la réserve du distributeur et/ou la caisse du pool.
// Analogie : on va plusieurs fois au guichet de l'anchor de test de Stellar (dépôt SEP-24 de 10 USDC, 9 reçus après frais),
// puis on range l'argent dans la tirelire des testeurs et dans la caisse du pool.
//
// Usage (PowerShell, depuis le dossier frontend) :
//   $env:ADMIN_SECRET = stellar keys show greg      # la clé reste dans cette fenêtre, jamais dans un fichier
//   node scripts/recharger-usdc.mjs --tours 20 --distributeur 100 --pool 80
//   Remove-Item Env:ADMIN_SECRET
//
// --tours N        : nombre de dépôts à l'anchor (≈ 9 USDC chacun)
// --distributeur X : USDC envoyés au distributeur (réserve des testeurs)
// --pool Y         : USDC prêtés au pool (fournir)
import { Address, Asset, BASE_FEE, Contract, Horizon, Keypair, Networks, Operation, TransactionBuilder, WebAuth, nativeToScVal, rpc } from '@stellar/stellar-sdk'

const PASS = Networks.TESTNET
const ANCHOR = 'https://testanchor.stellar.org'
const ANCHOR_UI_SERVER = 'https://anchor-reference-server-testanchor.stellar.org'
const ANCHOR_KEY = 'GCHLHDBOKG2JWMJQBTLSL5XG6NO7ESXI2TAQKZXCXWXB5WI2X6W233PR'
const USDC = new Asset('USDC', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5')
const USDC_SAC = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'
// Adresses par défaut = contrats en ligne ; après un redéploiement, passer DISTRIBUTEUR_ID et POOL_ID.
const DISTRIBUTEUR = process.env.DISTRIBUTEUR_ID?.trim() || 'CAMCKH3GBDEPO7ONTAMIRYJ7YCZWYT3G7F6Q33L2KEPLF7AFIB43A275'
const POOL = process.env.POOL_ID?.trim() || 'CCWKS7YCP62XJI6B523JLUGNQMOYXES2RD56LYKHGIDL4U2REWPTDHOK'

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? Number(process.argv[i + 1]) : d }
const tours = arg('tours', 0), versDistributeur = arg('distributeur', 0), versPool = arg('pool', 0)

const secret = process.env.ADMIN_SECRET?.trim()
if (!secret) { console.error('ADMIN_SECRET manquant (voir l’usage en haut du fichier).'); process.exit(1) }
const kp = Keypair.fromSecret(secret)
const moi = kp.publicKey()
const horizon = new Horizon.Server('https://horizon-testnet.stellar.org')
const server = new rpc.Server('https://soroban-testnet.stellar.org')
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const unites = (n) => BigInt(Math.round(n * 1e7))

async function solde() {
  const a = await horizon.loadAccount(moi)
  return Number(a.balances.find((b) => b.asset_code === 'USDC' && b.asset_issuer === USDC.getIssuer())?.balance ?? 0)
}

async function jetonAnchor() {
  const { transaction } = await (await fetch(`${ANCHOR}/auth?account=${moi}`)).json()
  const { tx } = WebAuth.readChallengeTx(transaction, ANCHOR_KEY, PASS, 'testanchor.stellar.org', 'testanchor.stellar.org')
  tx.sign(kp)
  const r = await (await fetch(`${ANCHOR}/auth`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transaction: tx.toXDR() }) })).json()
  if (!r.token) throw new Error('Connexion SEP-10 refusée par l’anchor')
  return r.token
}

/** Un dépôt SEP-24 de 10 USDC, formulaire de l'anchor rempli automatiquement (données de test) */
async function depot(token) {
  const dep = await (await fetch(`${ANCHOR}/sep24/transactions/deposit/interactive`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ asset_code: 'USDC', account: moi, amount: '10' }),
  })).json()
  if (!dep.url) throw new Error(`Dépôt refusé : ${JSON.stringify(dep)}`)
  const t = new URL(dep.url).searchParams.get('token')
  const { sessionId } = await (await fetch(`${ANCHOR_UI_SERVER}/start`, { method: 'POST', headers: { Authorization: `Bearer ${t}` } })).json()
  const s = await fetch(`${ANCHOR_UI_SERVER}/submit`, {
    method: 'POST', headers: { Authorization: `Bearer ${sessionId}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: '10', name: 'UnlockShares', surname: 'Faucet', email: 'faucet@example.com' }),
  })
  if (!s.ok) throw new Error(`Formulaire refusé (${s.status})`)
  for (let i = 0; i < 24; i++) {
    await pause(5000)
    const x = await (await fetch(`${ANCHOR}/sep24/transaction?id=${dep.id}`, { headers: { Authorization: `Bearer ${token}` } })).json()
    const st = x.transaction?.status
    if (st === 'completed') return Number(x.transaction.amount_out ?? 0)
    if (['error', 'expired', 'refunded'].includes(st)) throw new Error(`Dépôt ${st}${x.transaction?.message ? ` : ${x.transaction.message}` : ''}`)
  }
  throw new Error('Dépôt trop long (2 min)')
}

async function appeler(contractId, methode, args) {
  const src = await server.getAccount(moi)
  const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: PASS })
    .addOperation(new Contract(contractId).call(methode, ...args)).setTimeout(120).build()
  const prete = await server.prepareTransaction(tx)
  prete.sign(kp)
  const sent = await server.sendTransaction(prete)
  if (sent.status === 'ERROR') throw new Error(`${methode} refusé`)
  const res = await server.pollTransaction(sent.hash, { attempts: 30 })
  if (res.status !== 'SUCCESS') throw new Error(`${methode} : ${res.status}`)
  return sent.hash
}

// 0. Ligne de confiance USDC si besoin
const compte = await horizon.loadAccount(moi)
if (!compte.balances.some((b) => b.asset_code === 'USDC' && b.asset_issuer === USDC.getIssuer())) {
  const tx = new TransactionBuilder(compte, { fee: BASE_FEE, networkPassphrase: PASS }).addOperation(Operation.changeTrust({ asset: USDC })).setTimeout(60).build()
  tx.sign(kp)
  await horizon.submitTransaction(tx)
}

console.log(`Admin ${moi.slice(0, 4)}…${moi.slice(-4)} · USDC au départ : ${await solde()}`)

// 1. Dépôts à l'anchor
if (tours > 0) {
  const token = await jetonAnchor()
  for (let i = 1; i <= tours; i++) {
    try { console.log(`Dépôt ${i}/${tours} : +${await depot(token)} USDC`) } catch (e) { console.log(`Dépôt ${i}/${tours} : échec (${e.message})`) }
  }
  console.log(`USDC après dépôts : ${await solde()}`)
}

// 2. Répartition
if (versDistributeur > 0) {
  const h = await appeler(USDC_SAC, 'transfer', [new Address(moi).toScVal(), new Address(DISTRIBUTEUR).toScVal(), nativeToScVal(unites(versDistributeur), { type: 'i128' })])
  console.log(`→ ${versDistributeur} USDC envoyés au distributeur (${h.slice(0, 10)}…)`)
}
if (versPool > 0) {
  const h = await appeler(POOL, 'fournir', [new Address(moi).toScVal(), nativeToScVal(unites(versPool), { type: 'i128' })])
  console.log(`→ ${versPool} USDC prêtés au pool (${h.slice(0, 10)}…)`)
}
console.log(`Terminé · USDC restants chez l’admin : ${await solde()}`)
