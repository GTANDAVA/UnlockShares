// SEP-45 : connexion à un anchor pour un compte intelligent (adresse C…, ex. passkey).
// Ce fichier ne fait que VÉRIFIER le « défi » envoyé par l'anchor, sans réseau ni signature : il est testable seul.
// Analogie : avant de signer un formulaire au guichet, on relit qu'il porte bien le nom de la banque, notre nom et rien d'autre.
import { Address, Keypair, Networks, hash, scValToNative, xdr } from '@stellar/stellar-sdk'

export type Attendu = {
  /** Compte C… qui se connecte */
  account: string
  /** Domaine de l'anchor (home_domain) */
  homeDomain: string
  /** Domaine du service d'authentification (web_auth_domain) */
  webAuthDomain: string
  /** Contrat WEB_AUTH_CONTRACT_ID du stellar.toml */
  contrat: string
  /** Clé SIGNING_KEY du stellar.toml */
  cleServeur: string
  passphrase?: string
}

export type Defi = {
  entrees: xdr.SorobanAuthorizationEntry[]
  /** Position de l'entrée que le compte doit signer */
  indexClient: number
  /** Ledger d'expiration choisi par l'anchor (on reprend le même pour notre signature) */
  expiration: number
}

const credentialsAdresse = (e: xdr.SorobanAuthorizationEntry) => {
  const c = e.credentials
  if (c.type !== 'sorobanCredentialsAddress') throw new Error('Anchor challenge: unexpected credentials type.')
  return c.address
}

/** Lit et contrôle le défi SEP-45. Lève une erreur au moindre écart : on ne signe alors rien. */
export function verifierDefi(b64: string, a: Attendu): Defi {
  const passphrase = a.passphrase ?? Networks.TESTNET
  const entrees = xdr.decodeArray(xdr.SorobanAuthorizationEntry, b64, 'base64', { maxLength: 5 })
  if (entrees.length < 2) throw new Error('Anchor challenge: missing entries.')
  let nonce: string | null = null
  let indexClient = -1
  let expiration = 0
  let serveurOk = false

  entrees.forEach((e, i) => {
    const inv = e.rootInvocation
    if (inv.subInvocations.length) throw new Error('Anchor challenge: unexpected sub-call.')
    const f = inv.function
    if (f.type !== 'sorobanAuthorizedFunctionTypeContractFn') throw new Error('Anchor challenge: not a contract call.')
    const appel = f.contractFn
    if (Address.fromScAddress(appel.contractAddress).toString() !== a.contrat) throw new Error('Anchor challenge: wrong auth contract.')
    if (String(appel.functionName) !== 'web_auth_verify') throw new Error('Anchor challenge: wrong function.')
    if (appel.args.length !== 1) throw new Error('Anchor challenge: unexpected arguments.')
    const args = scValToNative(appel.args[0]) as Record<string, unknown>
    if (args.account !== a.account) throw new Error('Anchor challenge: not for this account.')
    if (args.home_domain !== a.homeDomain) throw new Error('Anchor challenge: wrong home domain.')
    if (args.web_auth_domain !== a.webAuthDomain) throw new Error('Anchor challenge: wrong auth domain.')
    if (args.web_auth_domain_account !== a.cleServeur) throw new Error('Anchor challenge: wrong anchor key.')
    if ('client_domain' in args || 'client_domain_account' in args) throw new Error('Anchor challenge: unexpected client domain.')
    if (typeof args.nonce !== 'string' || !args.nonce) throw new Error('Anchor challenge: missing nonce.')
    if (nonce !== null && args.nonce !== nonce) throw new Error('Anchor challenge: nonces differ.')
    nonce = args.nonce

    const cred = credentialsAdresse(e)
    const qui = Address.fromScAddress(cred.address).toString()
    if (qui === a.account) {
      if (indexClient !== -1) throw new Error('Anchor challenge: duplicate entry.')
      indexClient = i
    } else if (qui === a.cleServeur) {
      // L'anchor a signé son entrée : on vérifie que la signature est bien la sienne.
      const sig = scValToNative(cred.signature) as { public_key?: Uint8Array; signature?: Uint8Array }[] | null
      const s = Array.isArray(sig) ? sig[0] : undefined
      if (!s?.signature) throw new Error('Anchor challenge: anchor signature missing.')
      const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(new xdr.HashIdPreimageSorobanAuthorization({
        networkId: hash(new TextEncoder().encode(passphrase)),
        nonce: cred.nonce,
        signatureExpirationLedger: cred.signatureExpirationLedger,
        invocation: inv,
      }))
      if (!Keypair.fromPublicKey(a.cleServeur).verify(hash(preimage.toXdr()), s.signature)) throw new Error('Anchor challenge: invalid anchor signature.')
      serveurOk = true
      expiration = cred.signatureExpirationLedger
    } else {
      throw new Error('Anchor challenge: unexpected signer.')
    }
  })

  if (indexClient === -1) throw new Error('Anchor challenge: no entry for this account.')
  if (!serveurOk || !expiration) throw new Error('Anchor challenge: not signed by the anchor.')
  return { entrees, indexClient, expiration }
}

/** Remplace l'entrée du client par sa version signée et ré-encode le tout pour l'anchor. */
export function encoderReponse(d: Defi, entreeSigneeB64: string): string {
  const signee = xdr.SorobanAuthorizationEntry.fromXdr(entreeSigneeB64, 'base64')
  const toutes = d.entrees.map((e, i) => (i === d.indexClient ? signee : e))
  return xdr.encodeArray(xdr.SorobanAuthorizationEntry, toutes, 'base64')
}
