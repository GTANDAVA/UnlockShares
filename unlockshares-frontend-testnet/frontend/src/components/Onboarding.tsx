// Le parcours d'entrée : connecter Varial, puis recevoir les jetons de test en un clic.
// (Leçon du jury HackMeridian : sans jetons, impossible d'utiliser l'appli.)
import { Droplets, Wallet } from 'lucide-react'
import { useDemo } from '../lib/useDemo'
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

export function Onboarding() {
  const s = useDemo()
  const faucet = useFaucet()
  const connect = useConnect()
  if (s.mode === 'demo') return null

  if (s.error && !s.busy) return <p role="alert" className="pos onboard small s-danger">{s.error}</p>

  if (s.busy) return <div className="pos onboard" role="status"><b>{s.busy}</b></div>

  if (!s.address)
    return (
      <div className="pos onboard">
        <b>Step 1 of 3 · Connect your wallet</b>
        <span className="muted">UnlockShares runs on Stellar testnet with the Varial wallet extension (formerly Freighter), set to “Testnet”. Nothing real is at stake.</span>
        <button className="btn primary" onClick={connect}><Wallet className="i" aria-hidden />Connect Varial</button>
      </div>
    )

  if (!s.ready)
    return (
      <div className="pos onboard">
        <b>Step 2 of 3 · Get your test tokens</b>
        <span className="muted">One click gives you 100 test Apple shares (tAAPL) and 5,000 test dollars (tUSDC). Varial asks you to sign twice: once to add the tokens to your account, once to receive them.</span>
        <button className="btn primary" onClick={faucet}><Droplets className="i" aria-hidden />Get test tokens</button>
      </div>
    )

  if (!s.shares && !s.lent && !s.debt)
    return (
      <div className="pos onboard">
        <b>Step 3 of 3 · Try it</b>
        <span className="muted">Use shares as a guarantee and receive cash, or lend your USDC to the pool. Then open “Demo controls” to crash the Apple price and watch the protection sale.</span>
      </div>
    )

  return null
}
