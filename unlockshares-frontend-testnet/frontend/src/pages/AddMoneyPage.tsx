import { CircleAlert } from 'lucide-react'
import { AnchorDepositCard } from '../components/AnchorDepositCard'
import { MoneyGramCard } from '../components/MoneyGramCard'
import { useConnect } from '../components/Onboarding'
import { useDemo } from '../lib/useDemo'
import '../styles/cashout.css'

// On-ramp : plusieurs façons de faire entrer de l'argent (espèces, banque…) sous forme d'USDC de Circle.
// Analogie : une galerie de bureaux de change ; chaque carte est un guichet.
export function AddMoneyPage() {
  const s = useDemo()
  const connect = useConnect()

  return (
    <div className="co">
      <div className="co-banner" role="note">
        <CircleAlert className="v-ic" aria-hidden />
        <span><b>Testnet & sandbox — no real money moves.</b> Each option below brings Circle USDC to your wallet, ready to lend or to pay back a loan.</span>
      </div>

      <div className="head">
        <div>
          <h1>Add money</h1>
          <p className="muted">Turn cash or a bank transfer into USDC on Stellar.</p>
        </div>
      </div>

      {s.mode !== 'chain' ? (
        <div className="empty"><b>Testnet only</b><span className="muted">These on-ramps use real testnet transactions. Switch the app to testnet mode to try them.</span></div>
      ) : !s.address ? (
        <div className="empty"><b>Connect your wallet</b><span className="muted">The USDC is sent to your Varial wallet.</span><button className="btn primary" onClick={() => void connect()}>Connect Varial</button></div>
      ) : (
        <>
          <MoneyGramCard address={s.address} mode="on-ramp" />
          <AnchorDepositCard address={s.address} />
        </>
      )}
    </div>
  )
}
