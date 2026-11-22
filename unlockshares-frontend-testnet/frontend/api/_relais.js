// Relais de frais pour les comptes passkey : on transmet l'appel à OpenZeppelin Channels, qui paie les frais réseau.
// La clé API (OZ_CHANNELS_KEY) reste ici, côté serveur. Le relais refuse tout ce qui n'est pas :
//   1. la création d'un compte passkey officiel (smart-account-kit, stellar-accounts v0.8.0), ou
//   2. un appel d'un compte passkey vers NOS contrats (hub, prêt v3, robinets, distributeur), fonctions utilisateur seulement, ou
//   2 bis. l'activation ou l'arrêt du gardien par le compte lui-même (règle qui donne au robot gardien le droit
//      de rembourser seulement, voir contracts/gardien), et rien d'autre sur la gestion du compte, ou
//   3. un retrait vers un anchor : transfert d'USDC (Circle) du compte passkey vers une adresse « M… » (anchor + numéro
//      du retrait), 50 USDC maximum. L'adresse de l'anchor change selon les anchors : on exige le format M…, que seul
//      un retrait d'anchor utilise ici, plus le plafond et la limite d'appels par IP.
// But : que personne ne puisse faire payer n'importe quelle transaction par notre clé.
import { Address, StrKey, rpc, scValToNative, xdr } from '@stellar/stellar-sdk'
import { originAllowed } from './_moneygram.js'

export const CHANNELS_URL = 'https://channels.openzeppelin.com/testnet'
export const RPC_URL = 'https://soroban-testnet.stellar.org'

/** Compte passkey officiel accepté (stellar-accounts v0.8.0) */
export const WALLET_WASM = 'c514d35ea67eaea9bfc1fb3327854c0c06111bc1ddebd4fe217c504c1004b9e1'
/** Déployeur partagé du kit (clé publique connue, il ne fait que signer le déploiement) */
export const DEPLOYEUR = 'GAAH4OT36RRCCAGKARGPN2HLHT2NOBVFHO4GUHA6CF7UKQ4MMV24WQ4N'

/** Nos contrats et les seules fonctions qu'un utilisateur peut appeler via le relais */
export const CIBLES = {
  CCOM4RD25IFM76BXEKQUV4ZLF4AIDIK7XGANGA6FRJQUUWE7R3Q4EUHI: ['fournir', 'retirer_fonds', 'deposer', 'retirer', 'emprunter', 'rembourser', 'liquider', 'fixer_prix_demo', 'avancer_temps_perso'],
  CD3MLCLA2SQHC2X7P3W6PRNHJTZVMT5ELHS2MXT6GOFVAPXRIJVFBNH7: ['recevoir'], // robinet tAAPL
  CAMCKH3GBDEPO7ONTAMIRYJ7YCZWYT3G7F6Q33L2KEPLF7AFIB43A275: ['recevoir'], // distributeur USDC
  // Hub & spokes (en ligne depuis le 20/11) : mêmes gestes que le prêt v3, plus le retour au prix réel de la démo perso.
  CAPHBREM2DX36MACGMUJWMQ7ASCBR2LFJRCJQIEEUMQ7SI5IV4TFMIKF: ['fournir', 'retirer_fonds', 'deposer', 'retirer', 'emprunter', 'rembourser', 'liquider', 'fixer_prix_demo', 'reinitialiser_prix_demo', 'avancer_temps_perso'],
  CDVXQTFEDN2OJBZU2AB2O4DI76RFBRWJRRMRZMNLEVNSO2BMZNAJQAUO: ['recevoir', 'recevoir_titre'], // robinet des 12 actions
}

/** Gardien (option « rembourser seulement ») : contrat de règles, vérificateur ed25519 officiel, clé publique du robot */
export const GARDIEN_ID = 'CBBKHSDHUPFSKACFWMZUNWV66SQJYE7D2GHMPVBASSEMRCMUOJWMCOUF'
export const VERIFIER_ED25519 = 'CAAVTMCBXEIBPR64EAASKFXERVPYFZA2JYP5A3BG6PESWEFUJX5IHKN4'
export const ROBOT_GARDIEN = 'GCKET4LNNPLZRV37PWFVBIDSAVNUIEDKM2QSOUKPM4DCHVUBJ3E6UND7'

const adr = (v) => (v?.type === 'scvAddress' ? Address.fromScAddress(v.address).toString() : null)
const tag = (v) => (v?.type === 'scvVec' && v.vec?.[0]?.type === 'scvSymbol' ? scValToNative(v.vec[0]) : null)

/**
 * Le compte modifie ses propres règles : accepté seulement pour le gardien.
 * add_context_rule(context_type, name, valid_until, signers, policies) : règle Default, un seul signataire
 * = la clé du robot via le vérificateur ed25519, une seule politique = notre contrat gardien.
 * remove_context_rule(id) : jamais la règle 0 (celle de la passkey, sinon le compte serait bloqué).
 */
export function regleGardien(appel, signataires, cible) {
  if (new Set(signataires).size !== 1 || signataires[0] !== cible) return false
  const fn = String(appel.functionName)
  const a = appel.args
  try {
    if (fn === 'remove_context_rule') return a.length === 1 && a[0].type === 'scvU32' && a[0].u32 !== 0
    if (fn !== 'add_context_rule' || a.length !== 5) return false
    if (tag(a[0]) !== 'Default' || a[0].vec.length !== 1) return false
    const signers = a[3].type === 'scvVec' ? a[3].vec : null
    if (!signers || signers.length !== 1) return false
    const s = signers[0].vec
    if (tag(signers[0]) !== 'External' || s.length !== 3 || adr(s[1]) !== VERIFIER_ED25519 || s[2].type !== 'scvBytes') return false
    if (!Buffer.from(scValToNative(s[2])).equals(StrKey.decodeEd25519PublicKey(ROBOT_GARDIEN))) return false
    const politiques = a[4].type === 'scvMap' ? a[4].map : null
    return !!politiques && politiques.length === 1 && adr(politiques[0].key) === GARDIEN_ID
  } catch {
    return false
  }
}

/** USDC de Circle sur testnet (contrat SAC) et plafond d'un retrait vers un anchor (unités, 7 décimales) */
export const USDC_SAC = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'
export const MAX_RETRAIT_ANCHOR = 50n * 10_000_000n

/** Transfert d'USDC vers un anchor : de soi-même, vers une adresse M…, montant entre 0 et le plafond */
function retraitAnchor(appel, signataires) {
  const args = appel.args
  if (args.length !== 3 || new Set(signataires).size !== 1) return false
  try {
    const de = Address.fromScAddress(args[0].address).toString()
    const vers = Address.fromScAddress(args[1].address).toString()
    const montant = scValToNative(args[2])
    return de === signataires[0] && vers.startsWith('M') && typeof montant === 'bigint' && montant > 0n && montant <= MAX_RETRAIT_ANCHOR
  } catch {
    return false
  }
}

const MAX_AUTH = 3
const MAX_PAR_IP = 40 // appels par IP et par heure
const MAX_COMPTES_PAR_IP = 3 // créations de compte par IP et par heure
const FENETRE_MS = 60 * 60 * 1000

const refus = (status, error) => ({ status, body: { success: false, error } })

const hits = new Map()
function tropDe(cle, max) {
  const now = Date.now()
  const l = (hits.get(cle) ?? []).filter((t) => now - t < FENETRE_MS)
  if (l.length >= max) { hits.set(cle, l); return true }
  l.push(now)
  hits.set(cle, l)
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < FENETRE_MS)) hits.delete(k)
  return false
}

/** Lit le code (hash WASM) d'un contrat déployé */
export async function lireWasm(contractId, rpcUrl = RPC_URL) {
  const e = await new rpc.Server(rpcUrl).getContractData(contractId, xdr.ScVal.scvLedgerKeyContractInstance())
  const exe = e.val.contractData.val.instance.executable
  return exe.type === 'contractExecutableWasm' ? exe.wasmHash.toXDR('hex') : null
}

/**
 * Vérifie la demande. Renvoie null si elle est acceptée, sinon le refus.
 * `wasmDe` est injectable pour les tests (aucun appel réseau).
 */
export async function verifier(body, wasmDe = lireWasm) {
  if (!body || typeof body.func !== 'string' || !Array.isArray(body.auth)) return refus(400, 'Expected { func, auth }.')
  if (body.auth.length < 1 || body.auth.length > MAX_AUTH || body.auth.some((a) => typeof a !== 'string')) return refus(400, 'Invalid auth list.')
  let f, auth
  try {
    f = xdr.HostFunction.fromXDR(body.func, 'base64')
    auth = body.auth.map((a) => xdr.SorobanAuthorizationEntry.fromXDR(a, 'base64'))
  } catch {
    return refus(400, 'Invalid XDR.')
  }
  // Jamais d'autorisation « compte source » : elle engagerait le compte qui paie les frais.
  // Formats acceptés : adresse V1, V2 et « avec délégués » (on lit l'adresse qui signe).
  const adresses = auth.map((a) => {
    const c = a.credentials
    return c.type === 'sorobanCredentialsSourceAccount' ? null : (c.address ?? c.addressV2 ?? c.addressWithDelegates?.addressCredentials)?.address
  })
  if (adresses.some((x) => !x)) return refus(403, 'Only address authorizations are accepted.')
  const signataires = adresses.map((x) => Address.fromScAddress(x).toString())

  if (f.type === 'hostFunctionTypeCreateContractV2') {
    const v = f.createContractV2
    if (v.contractIdPreimage.type !== 'contractIdPreimageFromAddress') return refus(403, 'Unsupported deployment.')
    const deployeur = Address.fromScAddress(v.contractIdPreimage.fromAddress.address).toString()
    if (deployeur !== DEPLOYEUR) return refus(403, 'Unknown deployer.')
    if (v.executable.type !== 'contractExecutableWasm' || v.executable.wasmHash.toXDR('hex') !== WALLET_WASM) return refus(403, 'Only the official passkey account can be created.')
    if (auth.length !== 1 || signataires[0] !== DEPLOYEUR) return refus(403, 'Unexpected deployment authorization.')
    return { creation: true }
  }

  if (f.type !== 'hostFunctionTypeInvokeContract') return refus(403, 'Unsupported operation.')
  const cible = Address.fromScAddress(f.invokeContract.contractAddress).toString()
  const fn = String(f.invokeContract.functionName)
  const versAnchor = cible === USDC_SAC && fn === 'transfer' && retraitAnchor(f.invokeContract, signataires)
  const gardien = regleGardien(f.invokeContract, signataires, cible)
  if (!versAnchor && !gardien && !CIBLES[cible]?.includes(fn)) return refus(403, 'Only UnlockShares contracts can be called through this relay.')
  // Chaque signataire doit être un compte passkey officiel (adresse C… avec le bon code).
  for (const s of new Set(signataires)) {
    if (!s.startsWith('C')) return refus(403, 'Only passkey accounts are sponsored.')
    let wasm
    try {
      wasm = await wasmDe(s)
    } catch {
      return refus(502, 'Could not check the account. Try again.')
    }
    if (wasm !== WALLET_WASM) return refus(403, 'Only passkey accounts are sponsored.')
  }
  return { creation: false, compte: signataires[0] }
}

/** Envoie à OpenZeppelin Channels (même format que leur client officiel : { params: { func, auth } }). */
export async function soumettre(func, auth, cle, fetchFn = fetch) {
  const r = await fetchFn(`${CHANNELS_URL}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cle}` },
    body: JSON.stringify({ params: { func, auth } }),
  })
  const j = await r.json().catch(() => null)
  if (!j || j.success !== true) return refus(r.ok ? 400 : 502, j?.error ?? `Relay error (${r.status}).`)
  const d = j.data ?? {}
  return { status: 200, body: { success: true, data: { transactionId: d.transactionId, hash: d.hash, status: d.status } } }
}

export async function traiter({ origin, ip, body, env, wasmDe, fetchFn, dev = false }) {
  if (!originAllowed(origin, env, dev)) return refus(403, 'Origin not allowed.')
  if (!env.OZ_CHANNELS_KEY) return refus(503, 'Fee relay not configured yet.')
  if (tropDe(`ip:${ip}`, MAX_PAR_IP)) return refus(429, 'Too many requests. Try again later.')
  const v = await verifier(body, wasmDe)
  if (v.status) return v
  if (v.creation && tropDe(`creation:${ip}`, MAX_COMPTES_PAR_IP)) return refus(429, 'Too many accounts created from this connection. Try again later.')
  return soumettre(body.func, body.auth, env.OZ_CHANNELS_KEY.trim(), fetchFn)
}
