// Compte passkey (Face ID, empreinte) : un « compte intelligent » Stellar (adresse C…) créé avec Smart Account Kit.
// La clé reste dans l'appareil. Les frais réseau sont payés par notre relais (/api/relais) : l'utilisateur n'a pas besoin de XLM.
// Le kit est chargé seulement quand on en a besoin (il embarque sa propre copie du SDK Stellar).
import type { SmartAccountKit } from 'smart-account-kit'
import { StrKey } from '@stellar/stellar-sdk'
import { chain } from '../chainConfig'

/** Contrats officiels déjà déployés sur testnet (smart-account-kit 0.10, demo/.env.example) */
const ACCOUNT_WASM_HASH = 'c514d35ea67eaea9bfc1fb3327854c0c06111bc1ddebd4fe217c504c1004b9e1' // stellar-accounts v0.8.0
const WEBAUTHN_VERIFIER = 'CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F'

/** Règle d'autorisation par défaut créée avec le compte (la passkey signe tout) */
const REGLE_PAR_DEFAUT = 0

let kitP: Promise<SmartAccountKit> | null = null

function kit(): Promise<SmartAccountKit> {
  kitP ??= import('smart-account-kit').then(
    (m) =>
      new m.SmartAccountKit({
        rpcUrl: chain.rpcUrl,
        networkPassphrase: 'Test SDF Network ; September 2015',
        accountWasmHash: ACCOUNT_WASM_HASH,
        webauthnVerifierAddress: WEBAUTHN_VERIFIER,
        storage: new m.IndexedDBStorage(),
        rpName: 'UnlockShares',
        relayerUrl: `${window.location.origin}/api/relais`,
      }),
  )
  return kitP
}

/** Vrai si le navigateur sait créer des passkeys */
export const passkeyPossible = () => typeof window !== 'undefined' && !!window.PublicKeyCredential

const messageKit = (e: unknown) => {
  const t = e instanceof Error ? e.message : String(e)
  if (/NotAllowedError|cancel|abort|timed out/i.test(t)) return 'Passkey cancelled.'
  return t
}

/** Crée un compte : la passkey est créée dans l'appareil, puis le compte est déployé sur Stellar (frais payés par le relais). */
export async function creerCompte(): Promise<string> {
  const k = await kit()
  try {
    const r = await k.createWallet('UnlockShares', `UnlockShares ${new Date().toISOString().slice(0, 10)}`, { autoSubmit: true })
    if (r.submitResult && !r.submitResult.success) throw new Error(`Account creation failed: ${r.submitResult.error.message}`)
    return r.contractId
  } catch (e) {
    throw new Error(messageKit(e))
  }
}

/** Reconnecte un compte passkey : silencieux si une session existe, sinon demande la passkey si `demander`. */
export async function connecter(demander: boolean): Promise<string | null> {
  const k = await kit()
  try {
    const r = await k.connectWallet(demander ? { prompt: true } : undefined)
    return r?.contractId ?? null
  } catch (e) {
    if (!demander) return null
    throw new Error(messageKit(e))
  }
}

/** Session passkey déjà enregistrée sur cet appareil (sans ouvrir de fenêtre) */
export async function compteConnu(): Promise<string | null> {
  if (!passkeyPossible()) return null
  try {
    return await connecter(false)
  } catch {
    return null
  }
}

export async function deconnecter(): Promise<void> {
  if (!kitP) return
  await (await kit()).disconnect()
}

/**
 * Signe avec la passkey une autorisation (XDR base64) demandée par le contrat, valable jusqu'au ledger `expiration`.
 * `appels` = nombre d'appels couverts (principal + sous-appels) : une règle par appel, toutes = la règle par défaut.
 */
export async function signerAutorisation(entreeB64: string, expiration: number, appels = 1): Promise<string> {
  const k = await kit()
  try {
    return await k.signAuthEntry(entreeB64, { contextRuleIds: Array(Math.max(1, appels)).fill(REGLE_PAR_DEFAUT), expiration })
  } catch (e) {
    throw new Error(messageKit(e))
  }
}

/** Envoie l'appel au relais, qui paie les frais. Renvoie le hash de la transaction. */
export async function envoyerParRelais(funcB64: string, authB64: string[]): Promise<string> {
  const k = await kit()
  if (!k.relayer) throw new Error('Fee relay not configured.')
  const r = await k.relayer.send(funcB64, authB64)
  if (!r.success || !r.hash) throw new Error(r.error ?? 'The fee relay refused the transaction.')
  return r.hash
}

// ---------------------------------------------------------------------------
// Gardien (option, désactivée par défaut) : une 2e clé, celle du robot UnlockShares, reçoit une règle qui lui permet
// SEULEMENT de rembourser le prêt de ce compte avec l'USDC déjà dans le portefeuille, sous un plafond par jour.
// Les limites sont vérifiées par notre contrat « gardien » (contracts/gardien), pas par le site.
// ---------------------------------------------------------------------------

/** Vérificateur ed25519 officiel déjà déployé sur testnet (smart-account-kit, demo/.env.example) */
const VERIFIER_ED25519 = 'CAAVTMCBXEIBPR64EAASKFXERVPYFZA2JYP5A3BG6PESWEFUJX5IHKN4'
const NOM_REGLE_GARDIEN = 'UnlockShares guardian'

export type EtatGardien = { actif: boolean; regle?: number }

async function kitConnecte(): Promise<SmartAccountKit> {
  const k = await kit()
  if (!k.contractId) await k.connectWallet()
  return k
}

/** Cherche la règle gardien sur le compte passkey connecté (lecture seule, aucune signature). */
export async function lireGardien(gardienId: string): Promise<EtatGardien> {
  const k = await kitConnecte()
  const regles = await k.rules.list()
  const r = regles.find((x) => x.policies.includes(gardienId))
  return r ? { actif: true, regle: r.id } : { actif: false }
}

/**
 * Active le gardien : ajoute la règle « robot = rembourser seulement, plafond `plafondUsdc` par jour ».
 * La passkey signe (Face ID / empreinte), le relais paie les frais.
 */
export async function activerGardien(gardienId: string, robotG: string, plafondUsdc: number): Promise<string> {
  if (!(plafondUsdc > 0)) throw new Error('Choose a daily limit above 0.')
  const k = await kitConnecte()
  const m = await import('smart-account-kit')
  const signer = m.createEd25519Signer(VERIFIER_ED25519, StrKey.decodeEd25519PublicKey(robotG))
  const plafond = BigInt(Math.round(plafondUsdc * 10_000_000))
  try {
    const tx = await k.rules.add(m.createDefaultContext(), NOM_REGLE_GARDIEN, [signer], new Map([[gardienId, plafond]]))
    const r = await k.signAndSubmitAdmin(tx)
    if (!r.success) throw new Error(r.error?.message ?? 'The guardian could not be turned on.')
    return r.hash ?? ''
  } catch (e) {
    throw new Error(messageKit(e))
  }
}

/** Arrête le gardien : retire sa règle. Le robot perd aussitôt tout droit sur le compte. */
export async function desactiverGardien(regle: number): Promise<string> {
  if (regle === REGLE_PAR_DEFAUT) throw new Error('This rule belongs to your passkey and cannot be removed.')
  const k = await kitConnecte()
  try {
    const r = await k.signAndSubmitAdmin(await k.rules.remove(regle))
    if (!r.success) throw new Error(r.error?.message ?? 'The guardian could not be turned off.')
    return r.hash ?? ''
  } catch (e) {
    throw new Error(messageKit(e))
  }
}
