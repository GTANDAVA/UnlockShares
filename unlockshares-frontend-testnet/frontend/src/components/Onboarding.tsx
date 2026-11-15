// Le parcours d'entrée : créer un compte passkey (ou connecter Varial), puis recevoir les jetons de test en un clic.
// (Leçon du jury HackMeridian : sans jetons, impossible d'utiliser l'appli.)
import { Droplets, Fingerprint, Wallet } from 'lucide-react'
import { useDemo } from '../lib/useDemo'
import { chain } from '../chainConfig'
import { estPasskey, jetonPret } from '../services/chain'
import { passkeyPossible } from '../services/passkey'
import { actions } from '../services/app'
import { useDemoUi } from './demo'

export function useFaucet() {
  const { toast } = useDemoUi()
  return async () => {
    try {
      toast(await actions.faucet())
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
    }
  }
}

export function useConnect() {
  const { toast } = useDemoUi()
  return async () => {
    try {
      const a = await actions.connect()
      toast(`Wallet connected: ${a.slice(0, 4)}…${a.slice(-4)}`)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
    }
  }
}

export function usePasskey() {
  const { toast } = useDemoUi()
  return async (nouveau: boolean) => {
    try {
      const a = nouveau ? await actions.createPasskey() : await actions.connectPasskey()
      toast(`${nouveau ? 'Account created' : 'Signed in'}: ${a.slice(0, 4)}…${a.slice(-4)}`)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
    }
  }
}

/** Les 3 façons d'entrer : créer un compte passkey (recommandé), se reconnecter, ou Varial. */
export function ConnectButtons({ varialOnly = false }: { varialOnly?: boolean }) {
  const connect = useConnect()
  const passkey = usePasskey()
  if (varialOnly || !passkeyPossible())
    return <button className="btn primary" onClick={() => void connect()}><Wallet className="i" aria-hidden />Connect Varial</button>
  return (
    <div className="chips">
      <button className="btn primary" onClick={() => void passkey(true)}><Fingerprint className="i" aria-hidden />Create account</button>
      <button className="btn" onClick={() => void passkey(false)}>Sign in</button>
      <button className="btn" onClick={() => void connect()}><Wallet className="i" aria-hidden />Varial</button>
    </div>
  )
}

export function Onboarding() {
  const s = useDemo()
  const faucet = useFaucet()
  if (s.mode === 'demo') return null

  if (s.error && !s.busy) return <p role="alert" className="pos onboard small s-danger">{s.error}</p>

  if (s.busy) return <div className="pos onboard" role="status"><b>{s.busy}</b></div>

  if (!s.address)
    return (
      <div className="pos onboard">
        <b>Step 1 of 3 · Create your account</b>
        <span className="muted">{passkeyPossible()
          ? 'One tap with Face ID or your fingerprint. No extension, no XLM: UnlockShares pays the network fees. Already use the Varial wallet? Connect it instead. Stellar testnet, nothing real is at stake.'
          : 'UnlockShares runs on Stellar testnet with the Varial wallet extension (formerly Freighter), set to “Testnet”. Nothing real is at stake.'}</span>
        <ConnectButtons />
      </div>
    )

  if (!s.ready)
    return (
      <div className="pos onboard">
        <b>Step 2 of 3 · Get your test tokens</b>
        <span className="muted">One click gives you test Apple shares (tAAPL) to use as collateral{chain.distributeur ? <> and test {jetonPret()} to lend, pay back or cash out</> : <>; borrow to receive {jetonPret()}</>}.{estPasskey(s.address) ? ' Confirm with your passkey for each token.' : ' Varial asks you to sign twice: once to add the tokens to your account, once to receive them.'}</span>
        <button className="btn primary" onClick={faucet}><Droplets className="i" aria-hidden />Get test tokens</button>
      </div>
    )

  if (!s.shares && !s.lent && !s.debt)
    return (
      <div className="pos onboard">
        <b>Step 3 of 3 · Try it</b>
        <span className="muted">Use shares as a guarantee and receive cash, or lend your {jetonPret()} to the pool. Then open “Demo controls” to crash the Apple price and watch the protection sale.</span>
      </div>
    )

  return null
}
