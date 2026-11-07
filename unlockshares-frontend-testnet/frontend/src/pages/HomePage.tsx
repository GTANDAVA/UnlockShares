import { CircleArrowDown, CircleArrowUp, LayoutGrid, List, Lock } from 'lucide-react'
import { useState } from 'react'
import { Coin, eur, Gauge, Jar, LimitBlock, Pill, Stack, Term, usdc, useDemoUi } from '../components/demo'
import { StellarLogo } from '../components/logos'
import { useDemo } from '../lib/useDemo'
import { DEMO, derive } from '../services/mockDemo'
import { Onboarding } from '../components/Onboarding'

const pct = (x: number) => `${(x * 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`

const usdc2 = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} USDC`

export function HomePage() {
  const s = useDemo()
  const d = derive(s)
  const { open } = useDemoUi()
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const hour = new Date().getHours()
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const demo = s.mode === 'demo'
  const lendRate = demo ? DEMO.lendRateLabel : pct(s.market.lendRate)
  const borrowRate = demo ? DEMO.borrowRateLabel : pct(s.market.borrowRate)
  const monthly = demo ? d.monthlyCost : (s.debt * s.market.borrowRate) / 12
  const earnings = demo ? DEMO.earnings : usdc2(s.earnings)

  return (
    <>
      <div className="head">
        <h1>{hello}{demo ? ', Léa' : ''}</h1>
        <div className="chips">
          <button className="btn" onClick={() => open('deposit')}><Lock className="i" aria-hidden />Use as guarantee</button>
          <button className="btn" onClick={() => open('borrow')} disabled={!s.shares}><CircleArrowUp className="i" aria-hidden />Borrow</button>
          <button className="btn" onClick={() => open('lend')}><CircleArrowDown className="i" aria-hidden />Lend</button>
          <button className="round" onClick={() => open('repay')} aria-label="Pay back" title="Pay back" disabled={!s.debt}>⋯</button>
        </div>
      </div>

      <Onboarding />

      <div className="home">
        <div className="balance">
          <div><small className="muted">Balance<Term>collateral + deposits − debt</Term></small><div className="big">{eur(d.balance)}</div></div>
          <div className="divider" />
          <div className="line"><span className="muted">Yearly yield on what you lend<Term>position APY</Term></span><span>{s.lent ? lendRate : '–'}</span></div>
          <div className="line"><span className="muted">Total earnings</span><span>{s.lent ? earnings : '0 USDC'}</span></div>
          <div className="divider" />
          <LimitBlock />
        </div>
        <div className="chart jarbox"><Jar /></div>
      </div>

      <div className="divider" />
      <h2>Earn</h2>
      {s.lent ? (
        <div className="tbl"><table>
          <thead><tr><th>Asset</th><th>Hub</th><th>Your deposits</th><th>Yearly yield<Term>APY</Term></th><th>Earnings</th><th /></tr></thead>
          <tbody><tr>
            <td><div className="asset"><Coin kind="usdc">$</Coin><div>USD Coin<small>USDC</small></div></div></td>
            <td>UnlockShares Lending Hub</td>
            <td>{usdc(s.lent)}<small>{eur(s.lent)}</small></td>
            <td>{lendRate}</td>
            <td>{earnings}<small>{demo ? 'since 24 Oct' : 'interest paid by borrowers'}</small></td>
            <td><button className="btn" onClick={() => open('withdrawLend')}>Withdraw</button></td>
          </tr></tbody>
        </table></div>
      ) : (
        <div className="empty"><b>Start earning</b><span className="muted">Lend your USDC to borrowers and earn interest</span><button className="btn" onClick={() => open('lend')}><CircleArrowDown className="i" aria-hidden />Lend</button></div>
      )}

      <div className="divider" />
      <div className="head">
        <h2>Market Positions</h2>
        <div className="chips">
          <button className={`round ${view === 'grid' ? 'on' : ''}`} onClick={() => setView('grid')} aria-label="Cards"><LayoutGrid className="i" aria-hidden /></button>
          <button className={`round ${view === 'list' ? 'on' : ''}`} onClick={() => setView('list')} aria-label="Details"><List className="i" aria-hidden /></button>
        </div>
      </div>
      {!s.shares ? (
        <div className="empty"><b>No loan yet</b><span className="muted">Use your shares as a guarantee and receive cash against them</span><button className="btn" onClick={() => open('deposit')} disabled={!s.walletShares}><Lock className="i" aria-hidden />Use shares as guarantee</button></div>
      ) : view === 'grid' ? (
        <div className="cards">
          <button className="mcard" onClick={() => setView('list')}>
            <div className="line"><span><StellarLogo /> Stellar Stocks Market</span><Pill cls={d.zone.cls}>{d.usedPct} % used</Pill></div>
            <small className="muted">Net value<Term>collateral − debt</Term></small>
            <b className="num" style={{ marginTop: 0 }}>{eur(d.net)}</b>
            <small className="muted">Borrow rate <b>{borrowRate}</b> a year<Term>borrow APY</Term> · ≈ {eur(monthly)} / month</small>
            <Stack />
          </button>
        </div>
      ) : (
        <div className="pos">
          <div className="head"><h3><Coin kind="aapl">AAPL</Coin>Stellar Stocks Market</h3><span className="tag">Stellar testnet</span></div>
          <div className="posgrid">
            <div><small>Guarantee<Term>collateral</Term></small><b>{s.shares} AAPL</b><small>{eur(d.value)}</small></div>
            <div><small>Cash received<Term>borrowed</Term></small><b>{usdc(s.debt)}</b><small>{borrowRate} a year · ≈ {eur(monthly)} / month</small></div>
            <div><small>Safety price<Term>liquidation price</Term></small><b>{eur(d.safetyPrice)}</b><small>Apple today: {eur(s.price)}</small></div>
          </div>
          <Gauge ltv={d.ltv} />
          <div className="chips">
            <button className="btn" onClick={() => open('borrow')}><CircleArrowUp className="i" aria-hidden />Get more cash</button>
            <button className="btn" onClick={() => open('repay')} disabled={!s.debt}><CircleArrowDown className="i" aria-hidden />Pay back</button>
            <button className="btn" onClick={() => open('deposit')} disabled={!s.walletShares}><Lock className="i" aria-hidden />Add shares</button>
            <button className="btn" onClick={() => open('withdraw')}>Take shares back</button>
          </div>
        </div>
      )}

      <div className="divider" />
      <h2>Your Balance</h2>
      <div className="tbl"><table>
        <thead><tr><th>Asset</th><th>Wallet balance</th><th>Used as guarantee</th><th>Yearly yield if lent<Term>deposit APY</Term></th></tr></thead>
        <tbody>
          <tr><td><div className="asset"><Coin kind="usdc">$</Coin><div>USD Coin<small>USDC</small></div></div></td><td>{usdc(s.usdc)}<small>{eur(s.usdc)}</small></td><td>–</td><td>{lendRate}</td></tr>
          <tr><td><div className="asset"><Coin kind="aapl">AAPL</Coin><div>Apple<small>tokenized share</small></div></div></td><td>{s.walletShares} AAPL<small>{eur(s.walletShares * s.price)}</small></td><td>{s.shares} AAPL<small>{eur(d.value)}</small></td><td>– <small>guarantee only</small></td></tr>
          <tr><td><div className="asset"><Coin kind="xlm">XLM</Coin><div>Stellar Lumens<small>XLM, pays network fees</small></div></div></td><td>{Math.round(s.xlm).toLocaleString('fr-FR')} XLM<small>fees ≈ 0,001 € per action</small></td><td>–</td><td>–</td></tr>
        </tbody>
      </table></div>
    </>
  )
}
