// Robot gardien : surveille les comptes passkey qui ont ACTIVÉ le gardien et rembourse une partie de leur prêt
// quand il approche de la liquidation, avec l'USDC déjà dans leur portefeuille.
// Ce qu'il peut faire est limité par le contrat gardien (contracts/gardien) : rembourser la dette du compte
// lui-même, au hub, sous le plafond du jour choisi par l'utilisateur. Rien d'autre.
//
// Par défaut il est en LECTURE SEULE : il affiche ce qu'il ferait et n'envoie rien.
// Il n'envoie que si ENVOYER=oui ET que la clé secrète GARDIEN_ROBOT_CLE est présente.
//
// Variables : GARDIEN_ID, ENVOYER, GARDIEN_ROBOT_CLE (secret), RPC_URL (défaut testnet).
import { Account, Address, Contract, Keypair, Networks, Operation, TransactionBuilder, BASE_FEE, nativeToScVal, rpc, scValToNative, xdr } from '@stellar/stellar-sdk'
import { Ed25519Signer, KNOWN_AUTH_DIGEST_SCHEMES, signAuthEntryWithSigners } from 'smart-account-kit'
import { choisirRemboursement, restePlafond } from './gardien-calcul.mjs'

const GARDIEN_ID = (process.env.GARDIEN_ID || '').trim()
const CLE = (process.env.GARDIEN_ROBOT_CLE || '').trim()
const envoyer = process.env.ENVOYER === 'oui' && !!CLE
const RESEAU = Networks.TESTNET
/** Vérificateur ed25519 officiel (le même que celui enregistré dans la règle du compte, voir le site). */
const VERIFIER_ED25519 = 'CAAVTMCBXEIBPR64EAASKFXERVPYFZA2JYP5A3BG6PESWEFUJX5IHKN4'
/** Code du compte passkey officiel (stellar-accounts v0.8.0) : donne le format de signature attendu. */
const WALLET_WASM = 'c514d35ea67eaea9bfc1fb3327854c0c06111bc1ddebd4fe217c504c1004b9e1'
/** Compte quelconque pour les lectures (simulation seulement). */
const LECTEUR = 'GCKET4LNNPLZRV37PWFVBIDSAVNUIEDKM2QSOUKPM4DCHVUBJ3E6UND7'

const serveur = new rpc.Server(process.env.RPC_URL || 'https://soroban-testnet.stellar.org')
const court = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`
const usdc = (u) => (Number(u) / 1e7).toFixed(2)

async function lire(contrat, fn, ...args) {
  const tx = new TransactionBuilder(new Account(LECTEUR, '0'), { fee: BASE_FEE, networkPassphrase: RESEAU })
    .addOperation(new Contract(contrat).call(fn, ...args)).setTimeout(30).build()
  const r = await serveur.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(r)) throw new Error(`${fn} : ${r.error}`)
  return scValToNative(r.result.retval)
}

async function rembourser(moi, signer, compte, regle, hub, jeton, montant) {
  const source = await serveur.getAccount(moi.publicKey())
  const op = () => Operation.invokeContractFunction({ contract: hub, function: 'rembourser', args: argsRembourser(compte, jeton, montant) })
  // 1. Simulation : Stellar dit quelles autorisations il faut (le compte, pour rembourser puis le transfert d'USDC).
  const brouillon = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: RESEAU }).addOperation(op()).setTimeout(60).build()
  const sim = await serveur.simulateTransaction(brouillon)
  if (rpc.Api.isSimulationError(sim)) throw new Error(`simulation : ${sim.error}`)
  const { sequence } = await serveur.getLatestLedger()
  // 2. Le robot signe l'autorisation du compte AVEC SA RÈGLE gardien (une fois par appel : rembourser + transfert).
  const signees = []
  for (const e of sim.result.auth) {
    const appels = 1 + compterSousAppels(e.rootInvocation)
    const b64 = await signAuthEntryWithSigners(e.toXDR('base64'), [signer], {
      networkPassphrase: RESEAU,
      authDigestScheme: KNOWN_AUTH_DIGEST_SCHEMES[WALLET_WASM],
      contextRuleIds: Array(appels).fill(regle),
      expiration: sequence + 60,
    })
    signees.push(xdr.SorobanAuthorizationEntry.fromXDR(b64, 'base64'))
  }
  // 3. Nouvelle simulation avec les signatures (le contrôle du compte coûte des ressources), puis envoi.
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: RESEAU })
    .addOperation(Operation.invokeContractFunction({ contract: hub, function: 'rembourser', args: argsRembourser(compte, jeton, montant), auth: signees }))
    .setTimeout(60).build()
  const sim2 = await serveur.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(sim2)) throw new Error(`refusé par le compte ou le gardien : ${sim2.error}`)
  const pret = rpc.assembleTransaction(tx, sim2).build()
  pret.sign(moi)
  const envoi = await serveur.sendTransaction(pret)
  if (envoi.status === 'ERROR') throw new Error(`envoi refusé : ${JSON.stringify(envoi.errorResult)}`)
  for (let i = 0; i < 30; i++) {
    const r = await serveur.getTransaction(envoi.hash)
    if (r.status === 'SUCCESS') return envoi.hash
    if (r.status === 'FAILED') throw new Error(`transaction échouée ${envoi.hash}`)
    await new Promise((ok) => setTimeout(ok, 2000))
  }
  throw new Error(`pas de confirmation pour ${envoi.hash}`)
}

const argsRembourser = (compte, jeton, montant) => [new Address(compte).toScVal(), new Address(jeton).toScVal(), nativeToScVal(montant, { type: 'i128' })]

function compterSousAppels(inv) {
  return inv.subInvocations.reduce((n, s) => n + 1 + compterSousAppels(s), 0)
}

if (!GARDIEN_ID) {
  console.log('GARDIEN_ID manquant : rien à faire.')
  process.exit(0)
}
const moi = CLE ? Keypair.fromSecret(CLE) : null
const signer = CLE ? Ed25519Signer.fromSecret(CLE, VERIFIER_ED25519) : null
const { hub, usdc: jetonUsdc, periode } = await lire(GARDIEN_ID, 'reglages')
const inscrits = await lire(GARDIEN_ID, 'inscrits')
const { sequence: ledger } = await serveur.getLatestLedger()
console.log(`${inscrits.length} compte(s) avec le gardien activé${envoyer ? '' : ' (LECTURE SEULE : rien ne sera envoyé)'}`)
let code = 0
for (const { compte, regle } of inscrits) {
  try {
    const [etat, positions, solde] = await Promise.all([
      lire(GARDIEN_ID, 'etat', new Address(compte).toScVal(), nativeToScVal(regle, { type: 'u32' })),
      lire(hub, 'positions', new Address(compte).toScVal()),
      lire(jetonUsdc, 'balance', new Address(compte).toScVal()),
    ])
    const reste = restePlafond(etat, periode, ledger)
    const choix = choisirRemboursement(positions, reste, solde)
    if (!choix) { console.log(`${court(compte)} : prêt en sécurité, rien à faire.`); continue }
    const niveau = `${(Number(choix.ltv_bps) / 100).toFixed(1)} %`
    if (!choix.montant) { console.log(`${court(compte)} : prêt à ${niveau}, mais ${choix.raison}.`); continue }
    console.log(`${court(compte)} : prêt à ${niveau}, je rembourse ${usdc(choix.montant)} USDC (besoin ${usdc(choix.besoin)}, reste du jour ${usdc(reste)}, portefeuille ${usdc(solde)}).`)
    if (!envoyer) continue
    const hash = await rembourser(moi, signer, compte, regle, hub, choix.jeton, choix.montant)
    console.log(`  ✓ remboursé : ${hash}`)
  } catch (e) {
    code = 1
    console.log(`${court(compte)} : erreur ${e.message}`)
  }
}
process.exit(code)
