import { Banknote, Landmark } from 'lucide-react'
import { useState } from 'react'
import { AnchorDepositCard } from '../components/AnchorDepositCard'
import { Choice } from '../components/Choice'
import { MoneyGramCard } from '../components/MoneyGramCard'
import { useConnect } from '../components/Onboarding'
import { useDemo } from '../lib/useDemo'
import { estPasskey } from '../services/chain'
import '../styles/cashout.css'

// On-ramp : un titre, deux guichets au choix, une seule carte affichée.
export function AddMoneyPage() {
  const s = useDemo()
  const connect = useConnect()
  const [method, setMethod] = useState<'cash' | 'bank'>('bank')

  return (
    <div className="co">
      <div className="head">
        <div>
          <h1>Add money</h1>
          <p className="muted">Get USDC in your wallet. Testnet: no real money moves.</p>
        </div>
      </div>

      {s.mode !== 'chain' ? (
        <div className="empty"><b>Available on testnet only</b></div>
      ) : !s.address ? (
        <div className="empty"><b>Connect your wallet</b><button className="btn primary" onClick={() => void connect()}>Connect Varial</button></div>
      ) : estPasskey(s.address) ? (
        <div className="empty"><b>Needs the Varial wallet for now</b><span className="muted">MoneyGram and bank anchors work with a classic Stellar account. Passkey accounts are coming to this page later.</span></div>
      ) : (
        <>
          <Choice label="Deposit method" value={method} onChange={setMethod} options={[
            { id: 'bank', icon: Landmark, title: 'Bank transfer', sub: 'Through a Stellar anchor', tag: 'Testnet' },
            { id: 'cash', icon: Banknote, title: 'Cash', sub: 'At a MoneyGram location', tag: 'Sandbox' },
          ]} />
          {method === 'bank' ? <AnchorDepositCard address={s.address} /> : <MoneyGramCard address={s.address} mode="on-ramp" />}
        </>
      )}
    </div>
  )
}
