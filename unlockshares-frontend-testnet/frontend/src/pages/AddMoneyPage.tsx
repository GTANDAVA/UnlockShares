import { Banknote, Landmark } from 'lucide-react'
import { useState } from 'react'
import { AnchorDepositCard } from '../components/AnchorDepositCard'
import { Choice } from '../components/Choice'
import { MoneyGramCard } from '../components/MoneyGramCard'
import { VarialOnly } from '../components/VarialOnly'
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
      ) : !s.address || estPasskey(s.address) ? (
        <VarialOnly connect={connect} passkey={!!s.address} />
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
