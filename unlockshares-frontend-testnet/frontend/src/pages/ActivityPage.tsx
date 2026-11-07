import { useState } from 'react'
import { useDemo } from '../lib/useDemo'
import { court, lienCompte, lienTx } from '../services/chain'

export function ActivityPage() {
  const s = useDemo()
  const demo = s.mode === 'demo'
  const [mine, setMine] = useState(false)
  const list = s.history.filter((h) => !mine || h.mine).slice().reverse()
  return (
    <>
      <div className="head">
        <div><h1>Activity</h1><p className="muted">{demo ? 'Léa’s demo history.' : 'Every protocol operation on Stellar testnet (last 7 days), with its proof.'}</p></div>
        {!demo && s.address && <label className="switch"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only my operations</label>}
      </div>
      {list.length ? (
        <div className="tbl"><table>
          <thead><tr><th>Date</th><th>Action</th>{!demo && <th>Account</th>}<th>Amount</th><th>Proof on Stellar</th></tr></thead>
          <tbody>
            {list.map((h, i) => (
              <tr key={i}>
                <td>{h.date}</td>
                <td>{h.action}</td>
                {!demo && <td>{h.qui ? <a href={lienCompte(h.qui)} target="_blank" rel="noreferrer">{court(h.qui)}{h.mine ? ' (you)' : ''}</a> : '–'}</td>}
                <td>{h.amount}</td>
                <td>
                  {h.hash ? (
                    <a href={lienTx(h.hash)} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>stellar.expert ↗</a>
                  ) : (
                    <><span className="tag">Simulated</span> <small>no transaction: no stellar.expert link</small></>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : (
        <div className="empty"><b>{s.loaded ? 'No activity' : 'Loading…'}</b><span className="muted">{s.loaded ? 'No operation yet' : 'Reading the contract events on Stellar'}</span></div>
      )}
    </>
  )
}
