import { Coin, eur, Filters, Term, usdc, useDemoUi } from '../components/demo'
import { StellarLogo } from '../components/logos'
import { useDemo } from '../lib/useDemo'
import { DEMO } from '../services/mockDemo'

const pct = (x: number) => `${(x * 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`

export function EarnPage() {
  const s = useDemo()
  const { open } = useDemoUi()
  const demo = s.mode === 'demo'
  const deposits = demo ? DEMO.poolDeposits : usdc(s.market.totalLent)
  const rate = demo ? DEMO.lendRateLabel : pct(s.market.lendRate)
  return (
    <>
      <div className="head">
        <div><h1>Earn</h1><p className="muted">Lend USDC to the pool. Earn interest paid by borrowers.</p></div>
        <div className="kpis"><div className="kpi"><small>Pool deposits{demo ? ' (demo)' : ''}</small><b>{deposits}</b></div><div className="kpi"><small>Available in the pool</small><b>{demo ? '288 k USDC' : usdc(s.market.cash)}</b></div></div>
      </div>
      <Filters list={['Hubs', 'Assets']} wallet />
      <div className="hub">
        <h3><StellarLogo />UnlockShares Lending Hub</h3>
        <div className="hubmeta"><span>Lend USDC to people who borrow against tokenized shares on Stellar.</span><span>Total deposits <b>{deposits}</b>{!demo && ` · ${Math.round(s.market.used * 100)} % borrowed`}</span></div>
        <div className="tbl"><table>
          <thead><tr><th>Asset</th><th>Wallet balance</th><th>Lent</th><th>Yearly yield<Term>APY</Term></th><th>Total deposits</th><th /></tr></thead>
          <tbody><tr>
            <td><div className="asset"><Coin kind="usdc">$</Coin><div>USD Coin<small>USDC</small></div></div></td>
            <td>{usdc(s.usdc)}<small>{eur(s.usdc)}</small></td>
            <td>{s.lent ? usdc(s.lent) : '–'}</td>
            <td>{rate}</td>
            <td>{deposits}</td>
            <td><div className="chips"><button className="btn primary" onClick={() => open('lend')} disabled={!s.usdc}>Lend</button><button className="btn" onClick={() => open('withdrawLend')} disabled={!s.lent}>Withdraw</button></div></td>
          </tr></tbody>
        </table></div>
      </div>
    </>
  )
}
