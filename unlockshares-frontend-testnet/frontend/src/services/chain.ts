// SEUL point de contact avec Stellar : lectures (gratuites, simulées), transactions signées
// par Varial, robinet de jetons et historique des événements du contrat.
import { getAddress, getNetworkDetails, isConnected, requestAccess, signTransaction, WatchWalletChanges } from '@stellar/freighter-api'
import {
  Account, Address, Asset, BASE_FEE, Contract, Horizon, Networks, Operation, TransactionBuilder, nativeToScVal, rpc, scValToNative,
  type Transaction, type xdr,
} from '@stellar/stellar-sdk'
import { chain, chainReady, hubMode } from '../chainConfig'
import * as passkey from './passkey'

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
const i128u = (u: bigint) => nativeToScVal(u, { type: 'i128' })
const V2 = chain.pretVersion >= 2 || hubMode // v3 et le hub gardent l'interface v2 (+ oracle)
/** V2 : le contrat débite exactement le montant signé, puis rend l'excédent. La dette grandit de quelques unités
 *  entre la lecture et l'exécution : on ajoute une petite marge (0,01 % + 1000 unités) pour couvrir cet écart. */
const avecMarge = (u: bigint) => u + u / 10_000n + 1_000n

/* ---------- Messages d'erreur en français ---------- */

const ERREURS_PRET: Record<number, string> = {
  1: 'The amount must be above zero.',
  2: hubMode ? 'Not enough shares as guarantee: the loan would go above the maximum for this share.' : 'Not enough shares as guarantee: the loan would go above 50 % of their value.',
  3: 'The pool does not have enough cash right now.',
  4: hubMode ? 'This position cannot be liquidated: the loan is below the protection-sale threshold.' : 'This position cannot be liquidated: the loan is below 80 % of the shares’ value.',
  5: 'There is no loan to pay back.',
  6: V2 ? 'Only the admin can do this (or the demo tools are switched off).' : 'Only the admin can change the price (demo mode is off).',
  7: 'Insufficient balance.',
  8: V2 ? 'The demo price must be above zero and not above the reference price.' : 'The price must be above zero.',
  9: 'Borrow limit reached (per-address cap or share of the pool cash).',
  10: 'Price update in progress. Borrowing is paused; paying back still works.',
  // Hub & spokes
  11: 'This share is not accepted as a guarantee.',
  12: 'This share is paused: no new deposits or loans for now. Paying back still works.',
  13: 'The pool has reached its limit for loans against this share. Try another share or a smaller amount.',
  14: 'Invalid rules for this share.',
  15: 'This share is already in the hub.',
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
  // Seulement le refus du jeton tAAPL (ligne non autorisée), pas toute erreur contenant « authorization ».
  if (/op_not_authorized|deauthorized|is not authorized/i.test(t)) return `Your account is not yet allowed to hold the share: click “Get test tokens”. (Detail: ${t.slice(0, 160)})`
  if (/declined|rejected|User declined/i.test(t)) return 'Signature declined in Varial.'
  if (/Passkey cancelled/i.test(t)) return 'Passkey cancelled.'
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
  /** V2 : dette max par adresse (jeton prêté) et part max de la caisse par emprunt (fraction) */
  plafondFixe?: number; plafondCaisse?: number
}
export type Position = { garantie: number; dette: number; valeur: number; ltv: number; disponible: number; prixLiquidation: number; liquidable: boolean
  /** V2 seulement : prix utilisé pour CETTE position (prix de démo perso s'il existe) */
  prix?: number }

export async function lireMarche(): Promise<Marche> {
  const m = await lire<Record<string, bigint | boolean>>(chain.pret, 'marche')
  return {
    // Hub : chaque action a son prix (voir lireSpokes) ; le taux affiché ici est le taux de BASE.
    prix: hubMode ? 0 : fromUnits(m.prix as bigint),
    totalFourni: fromUnits(m.total_fourni as bigint),
    totalEmprunte: fromUnits(m.total_emprunte as bigint),
    caisse: fromUnits(m.caisse as bigint),
    modeDemo: Boolean(V2 ? m.demo_perso : m.mode_demo),
    utilisation: Number(m.utilisation_bps ?? 0) / 10_000,
    tauxEmprunt: Number((hubMode ? m.taux_base_bps : m.taux_emprunt_bps) ?? 0) / 10_000,
    tauxDepot: Number(m.taux_depot_bps ?? 0) / 10_000,
    reserve: fromUnits(m.reserve as bigint | undefined),
    plafondFixe: m.plafond_fixe === undefined ? undefined : fromUnits(m.plafond_fixe as bigint),
    plafondCaisse: m.plafond_caisse_bps === undefined ? undefined : Number(m.plafond_caisse_bps) / 10_000,
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
    prix: p.prix === undefined ? undefined : fromUnits(p.prix as bigint),
  }
}

export async function lireFourni(qui: string): Promise<number> {
  return fromUnits(await lire<bigint>(chain.pret, 'fourni', [addr(qui)]))
}

export type SoldeAction = { solde: number; trust: boolean; autorise: boolean }
export type Compte = { existe: boolean; xlm: number; aapl: number; usdc: number; trustAapl: boolean; trustUsdc: boolean; trustTusdc: boolean; aaplAutorise: boolean
  /** Hub : solde de chaque action de garantie, par adresse de jeton */
  actions?: Record<string, SoldeAction> }

/** Soldes du portefeuille (via Horizon, qui connaît les trustlines) */
export async function lireCompte(qui: string): Promise<Compte> {
  // Compte passkey (contrat) : pas de trustline, on lit directement les soldes des jetons.
  if (hubMode) return lireCompteHub(qui)
  if (estPasskey(qui)) {
    await chargerJetons()
    const [garantie, prete] = await lire<[string, string]>(chain.pret, 'jetons')
    const [aapl, usdc, autorise] = await Promise.all([
      lire<bigint>(garantie, 'balance', [addr(qui)]),
      lire<bigint>(prete, 'balance', [addr(qui)]),
      lire<boolean>(garantie, 'authorized', [addr(qui)]),
    ])
    return { existe: true, xlm: 0, aapl: fromUnits(aapl), usdc: fromUnits(usdc), trustAapl: true, trustUsdc: true, trustTusdc: true, aaplAutorise: Boolean(autorise) }
  }
  try {
    const a = await horizon.loadAccount(qui)
    const c: Compte = { existe: true, xlm: 0, aapl: 0, usdc: 0, trustAapl: false, trustUsdc: false, trustTusdc: false, aaplAutorise: false }
    for (const b of a.balances) {
      if (b.asset_type === 'native') c.xlm = Number(b.balance)
      else if ('asset_code' in b && b.asset_code === chain.aaplCode && b.asset_issuer === chain.emetteurAapl) {
        c.trustAapl = true
        c.aapl = Number(b.balance)
        c.aaplAutorise = Boolean(b.is_authorized)
      } else if ('asset_code' in b && b.asset_code === chain.usdcCode && b.asset_issuer === chain.emetteurUsdc) {
        c.trustUsdc = true
        c.usdc = Number(b.balance)
      } else if ('asset_code' in b && b.asset_code === 'TUSDC' && b.asset_issuer === chain.emetteurTusdc) {
        c.trustTusdc = true
      }
    }
    return c
  } catch (e) {
    if (e instanceof Error && /not found|404/i.test(e.message + String((e as { response?: { status?: number } }).response?.status))) {
      return { existe: false, xlm: 0, aapl: 0, usdc: 0, trustAapl: false, trustUsdc: false, trustTusdc: false, aaplAutorise: false }
    }
    throw e
  }
}

/* ---------- Transactions du contrat de prêt ---------- */

/** Compte passkey (compte intelligent, adresse C…) plutôt que compte Varial (G…) */
export const estPasskey = (a: string | null | undefined) => !!a && a.startsWith('C')

/** Passkey : on simule pour obtenir l'autorisation demandée par le contrat, la passkey la signe,
 *  puis le relais construit la transaction et paie les frais (aucun XLM pour l'utilisateur). */
/** Adresse qui doit signer une autorisation (formats V1, V2 et « avec délégués »), ou null pour « compte source ». */
function adresseSignataire(e: xdr.SorobanAuthorizationEntry): string | null {
  const c = e.credentials as unknown as { type: string; address?: { address: xdr.ScAddress }; addressV2?: { address: xdr.ScAddress }; addressWithDelegates?: { addressCredentials: { address: xdr.ScAddress } } }
  const a = c.address ?? c.addressV2 ?? c.addressWithDelegates?.addressCredentials
  return c.type === 'sorobanCredentialsSourceAccount' || !a ? null : Address.fromScAddress(a.address).toString()
}

/**
 * Nombre d'appels couverts par une autorisation (l'appel principal + les sous-appels, ex. le transfert des actions).
 * Le compte passkey attend une règle par appel : sinon il refuse (Error(Auth, InvalidAction)).
 */
function nombreContextes(i: xdr.SorobanAuthorizedInvocation): number {
  const ici = i.function.type === 'sorobanAuthorizedFunctionTypeContractFn' || String(i.function.type).startsWith('sorobanAuthorizedFunctionTypeCreateContract') ? 1 : 0
  return i.subInvocations.reduce((n, sub) => n + nombreContextes(sub), ici)
}

async function appelerPasskey(qui: string, contractId: string, methode: string, args: xdr.ScVal[]): Promise<string> {
  const tx = new TransactionBuilder(lecteur(), { fee: BASE_FEE, networkPassphrase: PASS })
    .addOperation(new Contract(contractId).call(methode, ...args))
    .setTimeout(120)
    .build()
  const sim = await server.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error)
  const expiration = sim.latestLedger + 60 // environ 5 minutes
  const auth: string[] = []
  for (const e of sim.result?.auth ?? []) {
    const b64 = e.toXDR('base64')
    // SDK 17 : les unions XDR exposent `.type` et des propriétés (plus de méthodes).
    const signataire = adresseSignataire(e)
    if (signataire !== qui) throw new Error(`Unexpected signature request (${signataire ?? 'source account'}): transaction cancelled.`)
    auth.push(await passkey.signerAutorisation(b64, expiration, nombreContextes(e.rootInvocation)))
  }
  const op = tx.operations[0] as Operation.InvokeHostFunction
  return passkey.envoyerParRelais(op.func.toXDR('base64'), auth)
}

/**
 * Compte passkey : transfert d'un jeton (contrat SAC) vers une adresse G…, C… ou M… (G… + numéro, CAP-67),
 * signé par la passkey et payé par le relais. `montant` en unités du jeton (7 décimales). Renvoie le hash.
 */
export async function transfererPasskey(qui: string, jeton: string, vers: string, montant: bigint): Promise<string> {
  if (!estPasskey(qui)) throw new Error('Passkey account expected.')
  return appelerPasskey(qui, jeton, 'transfer', [addr(qui), new Address(vers).toScVal(), nativeToScVal(montant, { type: 'i128' })])
}

/** Instructions de calcul ajoutées à l'estimation (coût : une fraction de centime de XLM de test). */
const MARGE_CPU = 1_000_000

async function appeler(qui: string, contractId: string, methode: string, args: xdr.ScVal[]): Promise<string> {
  if (estPasskey(qui)) return appelerPasskey(qui, contractId, methode, args)
  const src = await server.getAccount(qui)
  const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: PASS })
    .addOperation(new Contract(contractId).call(methode, ...args))
    .setTimeout(120)
    .build()
  // La simulation calcule les frais et révèle les erreurs du contrat avant la signature.
  // Petite marge de calcul : avec 12 actions, l'estimation est parfois trop juste de quelques millièmes.
  const sim = await server.simulateTransaction(tx, { cpuInstructions: MARGE_CPU })
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error)
  return envoyer(await signer(rpc.assembleTransaction(tx, sim).build(), qui))
}

export const pret = {
  fournir: (qui: string, n: number) => appeler(qui, chain.pret, 'fournir', [addr(qui), i128(n)]),
  retirerFonds: (qui: string, n: number) => appeler(qui, chain.pret, 'retirer_fonds', [addr(qui), i128(n)]),
  deposer: (qui: string, n: number) => appeler(qui, chain.pret, 'deposer', [addr(qui), i128(n)]),
  retirer: (qui: string, n: number) => appeler(qui, chain.pret, 'retirer', [addr(qui), i128(n)]),
  emprunter: (qui: string, n: number) => appeler(qui, chain.pret, 'emprunter', [addr(qui), i128(n)]),
  rembourser: async (qui: string, n: number) => {
    if (!V2) return appeler(qui, chain.pret, 'rembourser', [addr(qui), i128(n)])
    // V2 : pour « tout rembourser », on couvre les intérêts courus d'ici l'exécution (l'excédent est rendu).
    const p = await lire<Record<string, bigint>>(chain.pret, 'position', [addr(qui)])
    const u = toUnits(n) >= p.dette ? avecMarge(p.dette) : toUnits(n)
    return appeler(qui, chain.pret, 'rembourser', [addr(qui), i128u(u)])
  },
  /** V1 : prix global (mode démo). V2 : prix de démo de MA position seulement (≤ prix de référence). */
  fixerPrix: (qui: string, prix: number) =>
    V2
      ? appeler(qui, chain.pret, 'fixer_prix_demo', [addr(qui), i128(prix)])
      : appeler(qui, chain.pret, 'fixer_prix', [addr(qui), i128(prix)]),
  liquider: async (qui: string, cible: string) => {
    if (!V2) return appeler(qui, chain.pret, 'liquider', [addr(qui), addr(cible)])
    const max = await lire<bigint>(chain.pret, 'montant_liquidable', [addr(cible)])
    if (max <= 0n) throw new Error('Error(Contract, #4)')
    // Le liquidateur doit avoir de quoi payer la dette ET les intérêts courus : sinon, message clair avant de signer.
    const solde = toUnits((await lireCompte(qui)).usdc)
    if (solde < avecMarge(max)) {
      throw new Error(`To liquidate this loan you need ${(Number(avecMarge(max)) / UNITE).toFixed(4)} ${jetonPret()} (debt + interest), you have ${(Number(solde) / UNITE).toFixed(4)}.`)
    }
    return appeler(qui, chain.pret, 'liquider', [addr(qui), addr(cible), i128u(avecMarge(max))])
  },
  /** Démo : fait comme si `secondes` s'étaient écoulées (les intérêts tombent d'un coup). V2 : sur MA position seulement. */
  avancerTemps: (qui: string, secondes: number) =>
    appeler(qui, chain.pret, V2 ? 'avancer_temps_perso' : 'avancer_temps', [addr(qui), nativeToScVal(BigInt(secondes), { type: 'u64' })]),
}

/* ---------- Robinet : tout ce qu'il faut pour démarrer, en 3 étapes ---------- */

/* ---------- Jetons du pool, lus sur la blockchain ---------- */

/** Code du jeton prêté par le pool (USDC de Circle, USDS sur le pool de test…). Hors ligne (démo de Léa) : USDC. */
let codePret = chainReady ? chain.usdcCode : 'USDC'
/** Nom affiché du jeton prêté, toujours à jour après `chargerJetons()` */
export const jetonPret = () => (codePret === 'TUSDC' ? 'tUSDC' : codePret)
/** Nom long du jeton prêté, pour les tableaux d'actifs */
export const nomJetonPret = () => (codePret === 'USDC' ? 'USD Coin' : `Test dollar (${jetonPret()})`)

let jetonsCharges: Promise<void> | null = null
/** Lit les 2 jetons du contrat de prêt (`jetons()`), puis leur code et émetteur (`name()` du SAC = « CODE:ÉMETTEUR »).
 *  La blockchain fait foi : l'appli n'a plus besoin d'écrire le nom du jeton en dur. En cas d'échec, on garde la config. */
export function chargerJetons(): Promise<void> {
  if (hubMode) return chargerJetonsHub()
  jetonsCharges ??= (async () => {
    const [garantie, pret] = await lire<[string, string]>(chain.pret, 'jetons')
    const lireSac = async (id: string) => {
      const [code, emetteur] = String(await lire<string>(id, 'name')).split(':')
      return { code, emetteur: emetteur ?? '' }
    }
    const [g, p] = await Promise.all([lireSac(garantie), lireSac(pret)])
    if (p.code) codePret = chain.usdcCode = p.code
    if (p.emetteur) chain.emetteurUsdc = p.emetteur
    if (g.code) chain.aaplCode = g.code
    if (g.emetteur) chain.emetteurAapl = g.emetteur
  })().catch((e) => {
    console.warn('Lecture des jetons impossible, configuration conservée', e)
    jetonsCharges = null
  })
  return jetonsCharges
}

export async function obtenirJetons(qui: string, etape: (t: string) => void): Promise<{ hash?: string; text: string }> {
  if (hubMode) return obtenirJetonsHub(qui, etape)
  const signe = estPasskey(qui) ? 'confirm with your passkey' : 'sign in Varial'
  let c = await lireCompte(qui)
  if (!c.existe) {
    etape('1/3 · Creating the testnet account (Friendbot)…')
    const r = await fetch(`${chain.friendbotUrl}?addr=${encodeURIComponent(qui)}`)
    if (!r.ok) throw new Error('Friendbot could not create the account. Try again in a minute.')
    c = await lireCompte(qui)
  }
  const manque = [
    !c.trustAapl && new Asset(chain.aaplCode, chain.emetteurAapl),
    !c.trustUsdc && new Asset(chain.usdcCode, chain.emetteurUsdc),
    // Le robinet distribue encore du tUSDC : sans cette trustline, il échouerait.
    !!chain.emetteurTusdc && chain.emetteurTusdc !== chain.emetteurUsdc && !c.trustTusdc && new Asset('TUSDC', chain.emetteurTusdc),
  ].filter(Boolean) as Asset[]
  if (manque.length) {
    etape(`2/3 · Adding tAAPL and ${jetonPret()} to your account: sign in Varial…`)
    let b = new TransactionBuilder(await server.getAccount(qui), { fee: BASE_FEE, networkPassphrase: PASS })
    for (const a of manque) b = b.addOperation(Operation.changeTrust({ asset: a }))
    await envoyer(await signer(b.setTimeout(120).build(), qui))
  }
  const total = chain.distributeur ? 4 : 3
  const faits: string[] = []
  const notes: string[] = []
  let hash: string | undefined
  // Le robinet v2 a un montant réglable : on n'affiche pas de chiffre fixe.
  etape(`3/${total} · The faucet sends you ${V2 ? 'test' : '100'} tAAPL (your collateral): ${signe}…`)
  try {
    hash = await appeler(qui, chain.robinet, 'recevoir', [addr(qui)])
    faits.push(V2 ? 'tAAPL' : '100 tAAPL')
  } catch (e) {
    if (!/Error\(Contract, #1\)/.test(String(e instanceof Error ? e.message : e))) throw new Error(messageErreur(e, 'robinet'))
    notes.push('tAAPL already received this hour')
  }
  if (chain.distributeur) {
    etape(`4/4 · The dispenser sends you test ${jetonPret()}: ${signe}…`)
    try {
      hash = await appeler(qui, chain.distributeur, 'recevoir', [addr(qui)])
      faits.push(jetonPret())
    } catch (e) {
      const t = String(e instanceof Error ? e.message : e)
      if (/Error\(Contract, #1\)/.test(t)) notes.push(`${jetonPret()} already received today`)
      else if (/Error\(Contract, #2\)/.test(t)) notes.push(`${jetonPret()} reserve empty: get some on faucet.circle.com`)
      else if (/declined|rejected/i.test(t)) notes.push(`${jetonPret()}: signature declined`)
      else notes.push(`${jetonPret()}: ${messageErreur(e)}`)
    }
  }
  if (!faits.length && !notes.length) throw new Error('Nothing received.')
  return { hash, text: [faits.length ? `${faits.join(' and ')} received` : '', ...notes].filter(Boolean).join(' · ') }
}

/* ---------- Hub & spokes : une caisse USDC, un spoke (une position) par action ---------- */

/** Nom affiché de chaque ticker connu (les jetons de test s'appellent TAAPL, TNVDA…) */
const NOMS_ACTIONS: Record<string, string> = {
  AAPL: 'Apple', AMZN: 'Amazon', NVDA: 'Nvidia', CRCL: 'Circle', INTC: 'Intel', SPCX: 'SpaceX', ANT: 'Anthropic',
  AMD: 'AMD', COIN: 'Coinbase', IBM: 'IBM', NOK: 'Nokia', BB: 'BlackBerry',
}
const FONDS = new Set<string>()

export type InfoAction = { jeton: string; code: string; emetteur: string; ticker: string; nom: string; fonds: boolean }
const infos = new Map<string, InfoAction>()

/** Ticker affiché d'un code d'actif : TAAPL → AAPL, TTSLA → TSLA (sans toucher à un vrai TSLA). */
export function tickerDuCode(code: string): string {
  const c = code.toUpperCase()
  if (NOMS_ACTIONS[c] && !NOMS_ACTIONS[c.slice(1)]) return c
  if (c.startsWith('T') && NOMS_ACTIONS[c.slice(1)]) return c.slice(1)
  return c
}
export const tickerDe = (jeton: string) => infos.get(jeton)?.ticker ?? court(jeton)
export const infoAction = (jeton: string) => infos.get(jeton)
export const actionsConnues = () => [...infos.values()]
/** Titres du pack de bienvenue du robinet (vide = tous les titres). */
let pack = new Set<string>()
export const actionsDuPack = () => actionsConnues().filter((a) => !pack.size || pack.has(a.jeton))

let hubCharge: Promise<void> | null = null
function chargerJetonsHub(): Promise<void> {
  hubCharge ??= (async () => {
    const [pret, spokes] = await Promise.all([lire<string>(chain.pret, 'jeton_pret'), lire<Record<string, unknown>[]>(chain.pret, 'spokes')])
    const lireSac = async (id: string) => {
      const [code, emetteur] = String(await lire<string>(id, 'name')).split(':')
      return { code, emetteur: emetteur ?? '' }
    }
    const p = await lireSac(pret)
    if (p.code) codePret = chain.usdcCode = p.code
    if (p.emetteur) chain.emetteurUsdc = p.emetteur
    const lus = await Promise.all(spokes.map(async (sp) => ({ jeton: String(sp.jeton), ...(await lireSac(String(sp.jeton))) })))
    for (const l of lus) {
      const ticker = tickerDuCode(l.code)
      infos.set(l.jeton, { ...l, ticker, nom: NOMS_ACTIONS[ticker] ?? ticker, fonds: FONDS.has(ticker) })
    }
    // Ancien robinet sans pack : tous les titres.
    pack = new Set((await lire<string[]>(chain.robinet, 'pack').catch(() => [] as string[])).map(String))
  })().catch((e) => {
    console.warn('Lecture des jetons du hub impossible', e)
    hubCharge = null
  })
  return hubCharge
}

export type Spoke = InfoAction & {
  /** Fractions : 0.5 = 50 % */
  ltvMax: number; seuil: number; bonus: number; cible: number; prime: number; plafond: number
  actif: boolean; prix: number; oracle: boolean; prixMaj: Date | null
  emprunte: number; restePlafond: number; tauxEmprunt: number; garantieTotale: number
}

const bps = (v: unknown) => Number(v ?? 0) / 10_000

/** Les actions acceptées par le hub, avec leurs règles, leur prix et leur taux (base + prime). */
export async function lireSpokes(): Promise<Spoke[]> {
  await chargerJetonsHub()
  const v = await lire<Record<string, unknown>[]>(chain.pret, 'spokes')
  return v.map((sp) => {
    const jeton = String(sp.jeton)
    const r = sp.regles as Record<string, bigint>
    const maj = Number(sp.prix_maj ?? 0)
    const info = infos.get(jeton) ?? { jeton, code: '?', emetteur: '', ticker: court(jeton), nom: court(jeton), fonds: false }
    return {
      ...info,
      ltvMax: bps(r.ltv_max_bps), seuil: bps(r.seuil_bps), bonus: bps(r.bonus_bps), cible: bps(r.cible_bps), prime: bps(r.prime_bps), plafond: bps(r.plafond_bps),
      actif: Boolean(sp.actif), prix: fromUnits(sp.prix as bigint), oracle: Boolean(sp.oracle_actif), prixMaj: maj ? new Date(maj * 1000) : null,
      emprunte: fromUnits(sp.emprunte as bigint), restePlafond: fromUnits(sp.reste_plafond as bigint),
      tauxEmprunt: bps(sp.taux_emprunt_bps), garantieTotale: fromUnits(sp.garantie_totale as bigint),
    }
  })
}

export type PositionHub = Position & { jeton: string; detteDemo: number; prixDemo: boolean; prix: number }

const versPosition = (p: Record<string, unknown>): PositionHub => ({
  jeton: String(p.jeton),
  garantie: fromUnits(p.garantie as bigint),
  dette: fromUnits(p.dette as bigint),
  detteDemo: fromUnits(p.dette_demo as bigint),
  valeur: fromUnits(p.valeur as bigint),
  ltv: bps(p.ltv_bps),
  disponible: fromUnits(p.disponible as bigint),
  prixLiquidation: fromUnits(p.prix_liquidation as bigint),
  liquidable: Boolean(p.liquidable),
  prix: fromUnits(p.prix as bigint),
  prixDemo: Boolean(p.prix_demo_actif),
})

/** Toutes les positions non vides d'une adresse (une par action). */
export async function lirePositions(qui: string): Promise<PositionHub[]> {
  return (await lire<Record<string, unknown>[]>(chain.pret, 'positions', [addr(qui)])).map(versPosition)
}

async function lireCompteHub(qui: string): Promise<Compte> {
  await chargerJetonsHub()
  const liste = actionsConnues()
  const vide = (): Compte => ({ existe: false, xlm: 0, aapl: 0, usdc: 0, trustAapl: false, trustUsdc: false, trustTusdc: true, aaplAutorise: false, actions: {} })
  if (estPasskey(qui)) {
    // Compte passkey : pas de trustline, on lit les soldes directement dans les contrats des jetons.
    const pret = await lire<string>(chain.pret, 'jeton_pret')
    const [usdc, ...lus] = await Promise.all([
      lire<bigint>(pret, 'balance', [addr(qui)]),
      ...liste.map((a) => Promise.all([lire<bigint>(a.jeton, 'balance', [addr(qui)]), lire<boolean>(a.jeton, 'authorized', [addr(qui)])])),
    ]) as [bigint, ...[bigint, boolean][]]
    const actions: Record<string, SoldeAction> = {}
    liste.forEach((a, i) => (actions[a.jeton] = { solde: fromUnits(lus[i][0]), trust: true, autorise: Boolean(lus[i][1]) }))
    return { ...vide(), existe: true, usdc: fromUnits(usdc), trustUsdc: true, trustAapl: true, aaplAutorise: actionsDuPack().every((a) => actions[a.jeton].autorise), actions }
  }
  try {
    const compte = await horizon.loadAccount(qui)
    const c: Compte = { ...vide(), existe: true }
    const actions: Record<string, SoldeAction> = {}
    for (const a of liste) actions[a.jeton] = { solde: 0, trust: false, autorise: false }
    for (const b of compte.balances) {
      if (b.asset_type === 'native') c.xlm = Number(b.balance)
      else if ('asset_code' in b && b.asset_code === chain.usdcCode && b.asset_issuer === chain.emetteurUsdc) {
        c.trustUsdc = true
        c.usdc = Number(b.balance)
      } else if ('asset_code' in b) {
        const a = liste.find((x) => x.code === b.asset_code && x.emetteur === b.asset_issuer)
        if (a) actions[a.jeton] = { solde: Number(b.balance), trust: true, autorise: Boolean(b.is_authorized) }
      }
    }
    c.actions = actions
    // « Prêt » = les titres du pack de bienvenue ; les autres titres s'ajoutent à la demande.
    c.trustAapl = actionsDuPack().every((a) => actions[a.jeton].trust)
    c.aaplAutorise = actionsDuPack().every((a) => actions[a.jeton].autorise)
    return c
  } catch (e) {
    if (e instanceof Error && /not found|404/i.test(e.message + String((e as { response?: { status?: number } }).response?.status))) return vide()
    throw e
  }
}

/** Robinet multi-actions : une signature donne le pack de bienvenue (et le distributeur, des USDC). */
async function obtenirJetonsHub(qui: string, etape: (t: string) => void): Promise<{ hash?: string; text: string }> {
  await chargerJetonsHub()
  const signe = estPasskey(qui) ? 'confirm with your passkey' : 'sign in Varial'
  let c = await lireCompteHub(qui)
  if (!c.existe) {
    etape('1/3 · Creating the testnet account (Friendbot)…')
    const r = await fetch(`${chain.friendbotUrl}?addr=${encodeURIComponent(qui)}`)
    if (!r.ok) throw new Error('Friendbot could not create the account. Try again in a minute.')
    c = await lireCompteHub(qui)
  }
  if (!estPasskey(qui)) {
    const manque = [
      ...actionsDuPack().filter((a) => !c.actions?.[a.jeton]?.trust).map((a) => new Asset(a.code, a.emetteur)),
      ...(!c.trustUsdc ? [new Asset(chain.usdcCode, chain.emetteurUsdc)] : []),
    ]
    if (manque.length) {
      etape(`2/3 · Adding the test shares and ${jetonPret()} to your account: sign in Varial…`)
      let b = new TransactionBuilder(await server.getAccount(qui), { fee: BASE_FEE, networkPassphrase: PASS })
      for (const a of manque) b = b.addOperation(Operation.changeTrust({ asset: a }))
      await envoyer(await signer(b.setTimeout(120).build(), qui))
    }
  }
  const total = chain.distributeur ? 4 : 3
  const faits: string[] = []
  const notes: string[] = []
  let hash: string | undefined
  etape(`3/${total} · The faucet sends you your welcome pack of test shares (your collateral): ${signe}…`)
  try {
    hash = await appeler(qui, chain.robinet, 'recevoir', [addr(qui)])
    faits.push(`test shares (${actionsDuPack().map((a) => a.ticker).join(', ')})`)
  } catch (e) {
    if (!/Error\(Contract, #1\)/.test(String(e instanceof Error ? e.message : e))) throw new Error(messageErreur(e, 'robinet'))
    notes.push('test shares already received this hour')
  }
  if (chain.distributeur) {
    etape(`4/4 · The dispenser sends you test ${jetonPret()}: ${signe}…`)
    try {
      hash = await appeler(qui, chain.distributeur, 'recevoir', [addr(qui)])
      faits.push(jetonPret())
    } catch (e) {
      const t = String(e instanceof Error ? e.message : e)
      if (/Error\(Contract, #1\)/.test(t)) notes.push(`${jetonPret()} already received today`)
      else if (/Error\(Contract, #2\)/.test(t)) notes.push(`${jetonPret()} reserve empty: get some on faucet.circle.com`)
      else if (/declined|rejected/i.test(t)) notes.push(`${jetonPret()}: signature declined`)
      else notes.push(`${jetonPret()}: ${messageErreur(e)}`)
    }
  }
  if (!faits.length && !notes.length) throw new Error('Nothing received.')
  return { hash, text: [faits.length ? `${faits.join(' and ')} received` : '', ...notes].filter(Boolean).join(' · ') }
}

/** Un titre à la demande : ajoute sa ligne de confiance si besoin (compte Varial), puis le robinet en envoie. */
export async function recevoirTitre(qui: string, jeton: string, etape: (t: string) => void): Promise<{ hash: string; text: string }> {
  await chargerJetonsHub()
  const a = infos.get(jeton)
  if (!a) throw new Error('Unknown share.')
  if (!estPasskey(qui)) {
    const c = await lireCompteHub(qui)
    if (!c.existe) throw new Error('Get your welcome pack first (Get test tokens).')
    if (!c.actions?.[jeton]?.trust) {
      etape(`1/2 · Adding ${a.nom} to your account: sign in Varial…`)
      const b = new TransactionBuilder(await server.getAccount(qui), { fee: BASE_FEE, networkPassphrase: PASS })
        .addOperation(Operation.changeTrust({ asset: new Asset(a.code, a.emetteur) }))
      await envoyer(await signer(b.setTimeout(120).build(), qui))
    }
  }
  etape(`The faucet sends you test ${a.nom} shares: ${estPasskey(qui) ? 'confirm with your passkey' : 'sign in Varial'}…`)
  try {
    const hash = await appeler(qui, chain.robinet, 'recevoir_titre', [addr(qui), addr(jeton)])
    return { hash, text: `Test ${a.ticker} shares received` }
  } catch (e) {
    const t = String(e instanceof Error ? e.message : e)
    if (/Error\(Contract, #1\)/.test(t)) throw new Error(`${a.ticker} already received this hour. Try again later.`)
    if (/Error\(Contract, #4\)/.test(t)) throw new Error(`The faucet does not give ${a.ticker} yet.`)
    throw new Error(messageErreur(e, 'robinet'))
  }
}

const u64 = (n: number) => nativeToScVal(BigInt(n), { type: 'u64' })

/** Transactions du hub : les mêmes que le pool, avec l'action (`jeton`) en plus. */
export const hub = {
  deposer: (qui: string, jeton: string, n: number) => appeler(qui, chain.pret, 'deposer', [addr(qui), addr(jeton), i128(n)]),
  retirer: (qui: string, jeton: string, n: number) => appeler(qui, chain.pret, 'retirer', [addr(qui), addr(jeton), i128(n)]),
  emprunter: (qui: string, jeton: string, n: number) => appeler(qui, chain.pret, 'emprunter', [addr(qui), addr(jeton), i128(n)]),
  rembourser: async (qui: string, jeton: string, n: number) => {
    // « Tout rembourser » : on couvre les intérêts courus d'ici l'exécution (l'excédent est rendu).
    const p = await lire<Record<string, bigint>>(chain.pret, 'position', [addr(qui), addr(jeton)])
    const u = toUnits(n) >= p.dette ? avecMarge(p.dette) : toUnits(n)
    return appeler(qui, chain.pret, 'rembourser', [addr(qui), addr(jeton), i128u(u)])
  },
  /** Prix de démo de MA position sur cette action seulement (≤ prix de référence). */
  fixerPrixDemo: (qui: string, jeton: string, prix: number) => appeler(qui, chain.pret, 'fixer_prix_demo', [addr(qui), addr(jeton), i128(prix)]),
  avancerTemps: (qui: string, jeton: string, secondes: number) => appeler(qui, chain.pret, 'avancer_temps_perso', [addr(qui), addr(jeton), u64(secondes)]),
  liquider: async (qui: string, cible: string, jeton: string) => {
    const max = await lire<bigint>(chain.pret, 'montant_liquidable', [addr(cible), addr(jeton)])
    if (max <= 0n) throw new Error('Error(Contract, #4)')
    const solde = toUnits((await lireCompteHub(qui)).usdc)
    if (solde < avecMarge(max)) {
      throw new Error(`To liquidate this loan you need ${(Number(avecMarge(max)) / UNITE).toFixed(4)} ${jetonPret()} (debt + interest), you have ${(Number(solde) / UNITE).toFixed(4)}.`)
    }
    return appeler(qui, chain.pret, 'liquider', [addr(qui), addr(cible), addr(jeton), i128u(avecMarge(max))])
  },
}

/** Hub v2 : le mandat du gardien tel que le hub le stocke. */
export type MandatHub = { robot: string; plafondJour: number; depotActions: boolean; verseAujourdhui: number }

/** Durée des autorisations `approve` données au hub pour le gardien : ~30 jours de ledgers (5 s chacun). */
const DUREE_AUTORISATION = 30 * 17_280

/** Transactions du hub v2 (VITE_HUB_VERSION=2). Le hub en ligne aujourd'hui (v1) ne les a pas. */
export const hubV2 = {
  /** Emprunter et payer directement un commerçant (G…, C… ou M…). */
  emprunterVers: (qui: string, jeton: string, n: number, destinataire: string) =>
    appeler(qui, chain.pret, 'emprunter_vers', [addr(qui), addr(jeton), i128(n), new Address(destinataire).toScVal()]),
  /** Rembourser la dette de quelqu'un d'autre avec son propre USDC (« tout » = dette + marge, l'excédent est rendu). */
  rembourserPour: async (qui: string, emprunteur: string, jeton: string, n: number) => {
    const p = await lire<Record<string, bigint>>(chain.pret, 'position', [addr(emprunteur), addr(jeton)])
    if (!p.dette) throw new Error('This person has no loan on these shares.')
    const u = toUnits(n) >= p.dette ? avecMarge(p.dette) : toUnits(n)
    return appeler(qui, chain.pret, 'rembourser_pour', [addr(qui), addr(emprunteur), addr(jeton), i128u(u)])
  },
  lireMandat: async (qui: string): Promise<MandatHub | null> => {
    const m = await lire<Record<string, unknown> | null>(chain.pret, 'mandat', [addr(qui)])
    if (!m) return null
    return { robot: String(m.robot), plafondJour: Number(m.plafond_jour) / UNITE, depotActions: !!m.depot_actions, verseAujourdhui: Number(m.verse) / UNITE }
  },
  /**
   * Donner le mandat au robot : 1) le hub peut prendre au plus `plafondJour` × 30 USDC pendant ~30 jours (`approve`),
   * 2) le mandat lui-même (robot, plafond par jour). Deux signatures.
   */
  fixerMandat: async (qui: string, robot: string, plafondJour: number, etape: (t: string) => void) => {
    const usdc = await lire<string>(chain.pret, 'jeton_pret')
    const fin = (await server.getLatestLedger()).sequence + DUREE_AUTORISATION
    etape('1/2 · Allowing the pool to take up to your limit from your wallet…')
    await appeler(qui, usdc, 'approve', [addr(qui), addr(chain.pret), i128(plafondJour * 30), nativeToScVal(fin, { type: 'u32' })])
    etape('2/2 · Giving the guardian its mandate…')
    return appeler(qui, chain.pret, 'fixer_mandat', [addr(qui), new Address(robot).toScVal(), i128(plafondJour), nativeToScVal(false)])
  },
  /** Retirer le mandat, puis remettre l'autorisation USDC à zéro. */
  retirerMandat: async (qui: string) => {
    const h = await appeler(qui, chain.pret, 'retirer_mandat', [addr(qui)])
    const usdc = await lire<string>(chain.pret, 'jeton_pret')
    const fin = (await server.getLatestLedger()).sequence + 1
    await appeler(qui, usdc, 'approve', [addr(qui), addr(chain.pret), i128(0), nativeToScVal(fin, { type: 'u32' })]).catch(() => undefined)
    return h
  },
}

/** Emprunteurs vus dans l'historique du hub, avec l'action concernée */
export function emprunteursHub(evs: Evenement[]): { qui: string; jeton: string }[] {
  const vus = new Map<string, { qui: string; jeton: string }>()
  for (const e of evs) if ((e.type === NOMS.depose || e.type === NOMS.emprunte) && e.jeton) vus.set(`${e.qui}|${e.jeton}`, { qui: e.qui, jeton: e.jeton })
  return [...vus.values()]
}

/* ---------- Historique : les événements publiés par le contrat ---------- */

export type Evenement = { id: string; date: Date; type: string; qui: string; montant: string; hash: string; cible?: string; /** Montant brut (jeton prêté) quand il y en a un */ n?: number
  /** Hub : action concernée */ jeton?: string }

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
  // v2
  prix_demo_fixe: 'My demo price',
  temps_perso: 'My time jump (demo)',
  temps_perso_avance: 'My time jump (demo)',
  spoke_ajoute: 'New share accepted',
  spoke_modifie: 'New rules for a share',
  spoke_ouvert: 'Share opened or paused',
  oracle_fixe: 'Price source changed',
  plafonds_fixes: 'New borrow limits',
  demo_perso_fixee: 'Demo tools switched',
  // hub v2
  emprunte_vers: 'Pay a merchant',
  rembourse_pour: 'Paid back for someone',
  mandat_fixe: 'Guardian mandate changed',
  gardien_agi: 'Guardian paid back for you',
  code_mis_a_jour: 'Pool code updated',
}

/** Devise unique : montants d'argent en dollars (1 USDC = 1 $) */
const dollars = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
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
    // Hub : le jeton de garantie est dans les topics (après l'emprunteur), sauf pour prix_fixe / spoke_* (1er topic).
    const jetonEv = hubMode ? String((['prix_fixe', 'spoke_ajoute', 'spoke_modifie', 'spoke_ouvert', 'oracle_fixe'].includes(nom) ? topics[1] : topics[2]) ?? '') : ''
    const unite = hubMode ? (jetonEv ? tickerDe(jetonEv) : '') : 'AAPL'
    if (hubMode && ['spoke_ajoute', 'spoke_modifie', 'spoke_ouvert', 'oracle_fixe'].includes(nom)) {
      montant = nom === 'spoke_ouvert' ? `${unite} ${(data.actif as unknown as boolean) ? 'open' : 'paused'}` : unite
      qui = ''
    } else if (nom === 'depose' || nom === 'garantie_retiree') montant = nombre(fromUnits(data.montant as bigint), unite)
    else if (nom === 'prix_demo_fixe') {
      // v2 : prix de démo d'UNE position (0 = retour au prix de référence)
      const px = fromUnits(data.prix as bigint)
      montant = (px ? dollars(px) : 'back to reference price') + (hubMode ? ` · ${unite}` : '')
    } else if (nom === 'temps_perso' || nom === 'temps_perso_avance') {
      montant = `+${Math.round(Number(data.secondes) / 86_400)} days · ${dollars(fromUnits(data.interets as bigint))} demo interest${hubMode ? ` · ${unite}` : ''}`
    } else if (nom === 'plafonds_fixes') {
      const pl = (data.plafonds ?? {}) as unknown as Record<string, bigint>
      montant = `max ${dollars(fromUnits(pl.fixe))} per address, ${Number(pl.caisse_bps) / 100} % of cash per loan`
      qui = ''
    } else if (nom === 'demo_perso_fixee') {
      montant = (data.actif as unknown as boolean) ? 'on' : 'off'
      qui = ''
    } else if (nom === 'prix_fixe') {
      montant = dollars(fromUnits(data.prix as bigint)) + (hubMode ? ` · ${unite}` : '')
      qui = hubMode ? '' : String(data.par)
    } else if (nom === 'liquide') {
      cible = qui
      // Pool : le liquidateur est le 3e topic. Hub : le 3e topic est l'action, le liquidateur est dans les données.
      qui = hubMode ? String(data.liquidateur ?? '') : String(topics[2] ?? '')
      montant = `${nombre(fromUnits(data.garantie_saisie as bigint), unite)} for ${dollars(fromUnits(data.dette as bigint))}`
    } else if (nom === 'temps_avance') {
      montant = `+${Math.round(Number(data.secondes) / 86_400)} days`
      qui = String(data.par)
    } else if (nom === 'reglages_fixes') {
      const r = (data.reglages ?? {}) as unknown as Record<string, bigint>
      const p = (b: bigint) => `${(Number(b) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`
      montant = `${p(r.taux_coude_bps)} at ${p(r.coude_bps)} usage, max ${p(r.taux_max_bps)}, reserve ${p(r.reserve_bps)}`
      qui = ''
    } else if (nom === 'reserve_retiree') {
      montant = dollars(fromUnits(data.montant as bigint))
      qui = ''
    } else {
      n = fromUnits(data.montant as bigint)
      montant = dollars(n) + (hubMode && unite && (nom === 'emprunte' || nom === 'rembourse') ? ` · against ${unite}` : '')
    }
    return { id: ev.id, date: new Date(ev.ledgerClosedAt), type: NOMS[nom] ?? nom, qui, montant, hash: ev.txHash, cible, n, jeton: jetonEv || undefined }
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
