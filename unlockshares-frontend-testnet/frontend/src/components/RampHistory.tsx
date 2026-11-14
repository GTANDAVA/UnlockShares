import { useEffect, useState } from 'react'
import { court, lienCompte, lienTx, messageErreur } from '../services/chain'
import { lireMouvements, type Movement } from '../services/movements'

// Section « Deposits & cash-outs » de la page Activity : les entrées / sorties d'USDC du wallet connecté.
export function RampHistory({ address }: { address: string }) {
  const [rows, setRows] = useState<Movement[] | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    lireMouvements(address).then((r) => alive && setRows(r), (e) => alive && setErr(messageErreur(e)))
    return () => { alive = false }
  }, [address])

  return (
    <>
      <div className="head" style={{ marginTop: 28 }}>
        <div><h2>Deposits & cash-outs</h2><p className="muted">USDC entering or leaving your wallet (MoneyGram, Stellar anchors, transfers), read on Stellar testnet.</p></div>
      </div>
      {err ? (
        <p className="co-err">{err}</p>
      ) : !rows ? (
        <div className="empty"><b>Loading…</b><span className="muted">Reading your wallet history on Stellar</span></div>
      ) : !rows.length ? (
        <div className="empty"><b>No deposit or cash-out yet</b><span className="muted">Use Add money or Cash out.</span></div>
      ) : (
        <div className="tbl"><table>
          <thead><tr><th>Date</th><th>Action</th><th>From / to</th><th>Amount</th><th>Proof on Stellar</th></tr></thead>
          <tbody>
            {rows.map((m, i) => (
              <tr key={`${m.hash}-${i}`}>
                <td>{m.date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td>{m.label}{m.ref && <small>MoneyGram ref {m.ref}</small>}</td>
                <td><a href={lienCompte(m.other)} target="_blank" rel="noreferrer">{court(m.other)}</a></td>
                <td style={{ color: m.dir === 'in' ? 'var(--ok, #2e7d32)' : undefined }}>{m.dir === 'in' ? '+' : '−'}{m.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDC</td>
                <td><a href={lienTx(m.hash)} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>stellar.expert ↗</a></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </>
  )
}
