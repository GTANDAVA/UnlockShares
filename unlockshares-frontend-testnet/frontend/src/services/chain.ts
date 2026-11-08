// SEUL point de contact avec Stellar : lectures (gratuites, simulées), transactions signées
// par Varial, robinet de jetons et historique des événements du contrat.
import { getAddress, getNetworkDetails, isConnected, requestAccess, signTransaction, WatchWalletChanges } from '@stellar/freighter-api'
import {
  Account, Address, Asset, BASE_FEE, Contract, Horizon, Networks, Operation, TransactionBuilder, nativeToScVal, rpc, scValToNative,
  type Transaction, type xdr,
} from '@stellar/stellar-sdk'
import { chain } from '../chainConfig'

const PASS = Networks.TESTNET
const UNITE = 10_000_000
const server = new rpc.Server(chain.rpcUrl)
const horizon = new Horizon.Server(chain.horizonUrl)

/** Unités du contrat (i128, 7 décimales) → nombre affichable */
export const fromUnits = (v: bigint | number | string | undefined) => (v === undefined ? 0 : Number(BigInt(v)) / UNITE)
/** Nombre saisi → unités du contrat, sans erreur d'arrondi */
export const toUnits = (n: number) => BigInt(Math.round(n * UNITE))

const addr = (a: string) => new Address(a).toScVal()
const i128 = (n: number) => nativeToScVal(toUnits(n), { type: 'i128' })

/* ---------- Messages d'erreur en français ---------- */

const ERREURS_PRET: Record<number, string> = {
  1: 'The amount must be above zero.',
  2: 'Not enough shares as guarantee: the loan would go above 50 % of their value.',
  3: 'The pool does not have enough USDC right now.',
  4: 'This position cannot be liquidated: the loan is below 80 % of the shares’ value.',
  5: 'There is no loan to pay back.',
  6: 'Only the admin can change the price (demo mode is off).',
  7: 'Insufficient balance.',
  8: 'The price must be above zero.',
}

export function messageErreur(e: unknown, contrat: 'pret' | 'robinet' = 'pret'): string {
  const t = e instanceof Error ? e.message : String(e)
  const m = t.match(/Error\(Contract, #(\d+)\)/)
  if (m) {
    const n = Number(m[1])
    if (contrat === 'robinet' && n === 1) return 'You already received tokens less than an hour ago. Try again later.'
    return ERREURS_PRET[n] ?? `Contract error #${n}.`
  }
  if (/trustline|op_no_trust/i.test(t)) return 'Your account does not have the test tokens yet: click “Get test tokens” first.'
  if (/not authorized|authoriz/i.test(t)) return 'Your account is not yet allowed to hold the share: click “Get test tokens”.'
  if (/declined|rejected|User declined/i.test(t)) return 'Signature declined in Varial.'
  if (/balance|underfunded|insufficient/i.test(t)) return 'Insufficient balance.'
  return t.length > 180 ? `${t.slice(0, 180)}…` : t
}

/* ---------- Portefeuille Varial ---------- */

export async function connecter(): Promise<string> {
  const c = await isConnected()
  if (!c.isConnected) throw new Error('Varial (formerly Freighter) is not installed: add the extension from varialwallet.com, then reload the page.')
  const r = await requestAccess()
  if (r.error) throw new Error(r.error.message ?? 'Connection declined in Varial.')
  await verifierReseau()
  return r.address
}

/** Adresse déjà autorisée (sans ouvrir de fenêtre), ou null */
export async function adresseConnue(): Promise<string | null> {
  try {
    const c = await isConnected()
    if (!c.isConnected) return null
    const r = await getAddress()
    return r.address || null
  } catch {
    return null
  }
}

/** Prévient quand l'utilisateur change de compte dans Varial */
export function suivreCompte(cb: (address: string) => void) {
  new WatchWalletChanges(2000).watch(({ address }) => {
    if (address) cb(address)
  })
}

async function verifierReseau() {
  const n = await getNetworkDetails()
  if (n.networkPassphrase && n.networkPassphrase !== PASS) throw new Error('Varial is not on Testnet: open Varial and pick the “Testnet” network.')
}

async function signer(tx: Transaction, address: string): Promise<Transaction> {
  await verifierReseau()
  const r = await signTransaction(tx.toXDR(), { networkPassphrase: PASS, address })
  if (r.error) throw new Error(r.error.message ?? 'Signature declined in Varial.')
  return TransactionBuilder.fromXDR(r.signedTxXdr, PASS) as Transaction
}

/** Pour l'off-ramp (anchor.ts) : signature Varial et accès Horizon */
export { signer as signerFreighter, horizon, PASS }

/** Envoie une transaction signée et attend sa confirmation. Renvoie le hash (preuve sur stellar.expert). */
async function envoyer(tx: Transaction): Promise<string> {
  const sent = await server.sendTransaction(tx)
  if (sent.status === 'ERROR') throw new Error('The network rejected the transaction (XLM balance or sequence). Try again.')
  const res = await server.pollTransaction(sent.hash, { attempts: 30 })
  if (res.status !== 'SUCCESS') throw new Error(`Transaction failed (${res.status}).`)
  return sent.hash
}

/* ---------- Lectures (simulées, gratuites, sans signature) ---------- */

// N'importe quel compte sert de source pour une simulation.
const lecteur = () => new Account(chain.emetteurUsdc, '0')

async function lire<T>(contractId: string, methode: string, args: xdr.ScVal[] = []): Promise<T> {
  const tx = new TransactionBuilder(lecteur(), { fee: BASE_FEE, networkPassphrase: PASS })
    .addOperation(new Contract(contractId).call(methode, ...args))
    .setTimeout(30)
    .build()
  const sim = await server.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error)
  if (!sim.result) throw new Error(`Read ${methode}: no result`)
  return scValToNative(sim.result.retval) as T
}

export type Marche = {
  prix: number; totalFourni: number; totalEmprunte: number; caisse: number; modeDemo: boolean
  /** Fractions : 0.07 = 7 % */
  utilisation: number; tauxEmprunt: number; tauxDepot: number; reserve: number
}
export type Position = { garantie: number; dette: number; valeur: number; ltv: number; disponible: number; prixLiquidation: number; liquidable: boolean }

export async function lireMarche(): Promise<Marche> {
  const m = await lire<Record<string, bigint | boolean>>(chain.pret, 'marche')
  return {
    prix: fromUnits(m.prix as bigint),
    totalFourni: fromUnits(m.total_fourni as bigint),
    totalEmprunte: fromUnits(m.total_emprunte as bigint),
    caisse: fromUnits(m.caisse as bigint),
    modeDemo: Boolean(m.mode_demo),
    utilisation: Number(m.utilisation_bps ?? 0) / 10_000,
    tauxEmprunt: Number(m.taux_emprunt_bps ?? 0) / 10_000,
    tauxDepot: Number(m.taux_depot_bps ?? 0) / 10_000,
    reserve: fromUnits(m.reserve as bigint | undefined),
  }
}

export async function lirePosition(qui: string): Promise<Position> {
  const p = await lire<Record<string, bigint | boolean>>(chain.pret, 'position', [addr(qui)])
  return {
    garantie: fromUnits(p.garantie as bigint),
    dette: fromUnits(p.dette as bigint),
    valeur: fromUnits(p.valeur as bigint),
    ltv: Number(p.ltv_bps) / 10_000,
    disponible: fromUnits(p.disponible as bigint),
    prixLiquidation: fromUnits(p.prix_liquidation as bigint),
    liquidable: Boolean(p.liquidable),
  }
}

export async function lireFourni(qui: string): Promise<number> {
  return fromUnits(await lire<bigint>(chain.pret, 'fourni', [addr(qui)]))
}

export type Compte = { existe: boolean; xlm: number; aapl: number; usdc: number; trustAapl: boolean; trustUsdc: boolean; aaplAutorise: boolean }

/** Soldes du portefeuille (via Horizon, qui connaît les trustlines) */
export async function lireCompte(qui: string): Promise<Compte> {
  try {
    const a = await horizon.loadAccount(qui)
    const c: Compte = { existe: true, xlm: 0, aapl: 0, usdc: 0, trustAapl: false, trustUsdc: false, aaplAutorise: false }
    for (const b of a.balances) {
      if (b.asset_type === 'native') c.xlm = Number(b.balance)
      else if ('asset_code' in b && b.asset_code === 'TAAPL' && b.asset_issuer === chain.emetteurAapl) {
        c.trustAapl = true
        c.aapl = Number(b.balance)
        c.aaplAutorise = Boolean(b.is_authorized)
      } else if ('asset_code' in b && b.asset_code === 'TUSDC' && b.asset_issuer === chain.emetteurUsdc) {
        c.trustUsdc = true
        c.usdc = Number(b.balance)
      }
    }
    return c
  } catch (e) {
    if (e instanceof Error && /not found|404/i.test(e.message + String((e as { response?: { status?: number } }).response?.status))) {
      return { existe: false, xlm: 0, aapl: 0, usdc: 0, trustAapl: false, trustUsdc: false, aaplAutorise: false }
    }
    throw e
  }
}

/* ---------- Transactions du contrat de prêt ---------- */

async function appeler(qui: string, contractId: string, methode: string, args: xdr.ScVal[]): Promise<string> {
  const src = await server.getAccount(qui)
  const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: PASS })
    .addOperation(new Contract(contractId).call(methode, ...args))
    .setTimeout(120)
    .build()
  // La simulation calcule les frais et révèle les erreurs du contrat avant la signature.
  const prete = await server.prepareTransaction(tx)
  return envoyer(await signer(prete, qui))
}

export const pret = {
  fournir: (qui: string, n: number) => appeler(qui, chain.pret, 'fournir', [addr(qui), i128(n)]),
  retirerFonds: (qui: string, n: number) => appeler(qui, chain.pret, 'retirer_fonds', [addr(qui), i128(n)]),
  deposer: (qui: string, n: number) => appeler(qui, chain.pret, 'deposer', [addr(qui), i128(n)]),
  retirer: (qui: string, n: number) => appeler(qui, chain.pret, 'retirer', [addr(qui), i128(n)]),
  emprunter: (qui: string, n: number) => appeler(qui, chain.pret, 'emprunter', [addr(qui), i128(n)]),
  rembourser: (qui: string, n: number) => appeler(qui, chain.pret, 'rembourser', [addr(qui), i128(n)]),
  fixerPrix: (qui: string, prix: number) => appeler(qui, chain.pret, 'fixer_prix', [addr(qui), i128(prix)]),
  liquider: (qui: string, cible: string) => appeler(qui, chain.pret, 'liquider', [addr(qui), addr(cible)]),
  /** Démo : fait comme si `secondes` s'étaient écoulées (les intérêts tombent d'un coup) */
  avancerTemps: (qui: string, secondes: number) => appeler(qui, chain.pret, 'avancer_temps', [addr(qui), nativeToScVal(BigInt(secondes), { type: 'u64' })]),
}

/* ---------- Robinet : tout ce qu'il faut pour démarrer, en 3 étapes ---------- */

export async function obtenirJetons(qui: string, etape: (t: string) => void): Promise<string> {
  let c = await lireCompte(qui)
  if (!c.existe) {
    etape('1/3 · Creating the testnet account (Friendbot)…')
    const r = await fetch(`${chain.friendbotUrl}?addr=${encodeURIComponent(qui)}`)
    if (!r.ok) throw new Error('Friendbot could not create the account. Try again in a minute.')
    c = await lireCompte(qui)
  }
  const manque = [
    !c.trustAapl && new Asset('TAAPL', chain.emetteurAapl),
    !c.trustUsdc && new Asset('TUSDC', chain.emetteurUsdc),
  ].filter(Boolean) as Asset[]
  if (manque.length) {
    etape('2/3 · Adding tAAPL and tUSDC to your account: sign in Varial…')
    let b = new TransactionBuilder(await server.getAccount(qui), { fee: BASE_FEE, networkPassphrase: PASS })
    for (const a of manque) b = b.addOperation(Operation.changeTrust({ asset: a }))
    await envoyer(await signer(b.setTimeout(120).build(), qui))
  }
  etape('3/3 · The faucet sends you 100 tAAPL and 5,000 tUSDC: sign in Varial…')
  try {
    return await appeler(qui, chain.robinet, 'recevoir', [addr(qui)])
  } catch (e) {
    throw new Error(messageErreur(e, 'robinet'))
  }
}

/* ---------- Historique : les événements publiés par le contrat ---------- */

export type Evenement = { id: string; date: Date; type: string; qui: string; montant: string; hash: string; cible?: string; /** Montant brut (tUSDC) quand il y en a un */ n?: number }

const NOMS: Record<string, string> = {
  fourni: 'Lend',
  fonds_retires: 'Withdraw from pool',
  depose: 'Deposit shares',
  garantie_retiree: 'Withdraw shares',
  emprunte: 'Borrow',
  rembourse: 'Pay back',
  liquide: 'Protection sale (liquidation)',
  prix_fixe: 'New Apple price (demo oracle)',
  temps_avance: 'Time jump (demo)',
  reglages_fixes: 'New interest settings',
  reserve_retiree: 'Protocol reserve withdrawn',
}

const nombre = (n: number, unite: string) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${unite}`

// Cache : la 1re lecture parcourt l'historique page par page, ensuite on ne lit que la suite.
let evBruts: rpc.Api.EventResponse[] = []
let evCurseur: string | undefined
/** Le curseur RPC commence par un identifiant dont les 32 bits hauts sont le numéro de ledger */
const ledgerDuCurseur = (c: string) => Number(BigInt(c.split('-')[0]) >> 32n)

export async function lireEvenements(): Promise<Evenement[]> {
  const filters = [{ type: 'contract' as const, contractIds: [chain.pret] }]
  if (!evCurseur) {
    const dernier = (await server.getLatestLedger()).sequence
    const debut = Math.max(1, dernier - 6 * 17_280)
    // Le RPC ne parcourt que 10 000 ledgers par appel : on lit toutes les fenêtres en parallèle (1 aller-retour au lieu de 11).
    const debuts: number[] = []
    for (let l = debut; l <= dernier; l += 10_000) debuts.push(l)
    const lus = await Promise.allSettled(debuts.map((l) => server.getEvents({ startLedger: l, filters, limit: 200 })))
    // Une fenêtre plus ancienne que l'historique gardé par le RPC est refusée : on l'ignore.
    const rs = lus.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    if (!rs.length) throw new Error('Cannot read the contract events.')
    evBruts = rs.flatMap((r) => r.events)
    evCurseur = rs[rs.length - 1].cursor
  } else for (let i = 0; i < 30 && evCurseur; i++) {
    // Ensuite on ne lit que la suite, en suivant le curseur jusqu'au dernier ledger.
    const r = await server.getEvents({ cursor: evCurseur, filters, limit: 200 })
    evBruts = evBruts.concat(r.events)
    if (!r.cursor || r.cursor === evCurseur) break
    evCurseur = r.cursor
    // On s'arrête quand le curseur a rattrapé le dernier ledger (pas sur une fenêtre vide : il peut en avoir plusieurs d'affilée).
    if (ledgerDuCurseur(evCurseur) >= r.latestLedger) break
  }
  const vus = new Set<string>()
  const res = { events: evBruts.filter((e) => (vus.has(e.id) ? false : (vus.add(e.id), true))) }
  return res.events.map((ev) => {
    const topics = ev.topic.map((t) => scValToNative(t))
    const nom = String(topics[0])
    const data = scValToNative(ev.value) as Record<string, bigint | string>
    let montant = ''
    let qui = String(topics[1] ?? '')
    let cible: string | undefined
    let n: number | undefined
    if (nom === 'depose' || nom === 'garantie_retiree') montant = nombre(fromUnits(data.montant as bigint), 'AAPL')
    else if (nom === 'prix_fixe') {
      montant = nombre(fromUnits(data.prix as bigint), '€')
      qui = String(data.par)
    } else if (nom === 'liquide') {
      cible = qui
      qui = String(topics[2] ?? '')
      montant = `${nombre(fromUnits(data.garantie_saisie as bigint), 'AAPL')} for ${nombre(fromUnits(data.dette as bigint), 'USDC')}`
    } else if (nom === 'temps_avance') {
      montant = `+${Math.round(Number(data.secondes) / 86_400)} days`
      qui = String(data.par)
    } else if (nom === 'reglages_fixes') {
      const r = (data.reglages ?? {}) as unknown as Record<string, bigint>
      const p = (b: bigint) => `${(Number(b) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`
      montant = `${p(r.taux_coude_bps)} at ${p(r.coude_bps)} usage, max ${p(r.taux_max_bps)}, reserve ${p(r.reserve_bps)}`
      qui = ''
    } else if (nom === 'reserve_retiree') {
      montant = nombre(fromUnits(data.montant as bigint), 'USDC')
      qui = ''
    } else {
      n = fromUnits(data.montant as bigint)
      montant = nombre(n, 'USDC')
    }
    return { id: ev.id, date: new Date(ev.ledgerClosedAt), type: NOMS[nom] ?? nom, qui, montant, hash: ev.txHash, cible, n }
  })
}

/** Emprunteurs vus dans l'historique (pour la page Contrôles de démo) */
/** Ce que `qui` a versé au pool moins ce qu'il a retiré (pour calculer ses gains) */
export function netFourni(evs: Evenement[], qui: string): number {
  let net = 0
  for (const e of evs) {
    if (e.qui !== qui || e.n === undefined) continue
    if (e.type === NOMS.fourni) net += e.n
    else if (e.type === NOMS.fonds_retires) net -= e.n
  }
  return net
}

export function emprunteurs(evs: Evenement[]): string[] {
  const s = new Set<string>()
  for (const e of evs) if (e.type === NOMS.depose || e.type === NOMS.emprunte) s.add(e.qui)
  return [...s]
}

export const lienTx = (hash: string) => `${chain.explorer}/tx/${hash}`
export const lienCompte = (a: string) => `${chain.explorer}/${a.startsWith('C') ? 'contract' : 'account'}/${a}`
export const court = (a: string) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '')
