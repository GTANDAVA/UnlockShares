import { Check, Landmark, LoaderCircle, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { lienTx, messageErreur } from '../services/chain'
import { addUsdcTrustline, openMoneyGram, usdcBalance, type RampMode } from '../services/moneygram'

// Widget MoneyGram (sandbox, testnet). off-ramp : USDC de Circle → espèces. on-ramp : espèces au guichet → USDC dans le wallet.
export function MoneyGramCard({ address, mode = 'off-ramp' }: { address: string; mode?: RampMode }) {
  const cashIn = mode === 'on-ramp'
  const box = useRef<HTMLDivElement>(null)
  const close = useRef<(() => void) | null>(null)
  const [usdc, setUsdc] = useState<number | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState('')
  const [hash, setHash] = useState('')
  const [ref, setRef] = useState('')

  const refresh = useCallback(() => { usdcBalance(address).then(setUsdc, () => setUsdc(null)) }, [address])
  useEffect(refresh, [refresh])
  useEffect(() => () => close.current?.(), [])

  const trust = async () => {
    setBusy(true); setErr('')
    try { await addUsdcTrustline(address); refresh() } catch (e) { setErr(messageErreur(e)) } finally { setBusy(false) }
  }

  const start = async () => {
    if (!box.current) return
    setBusy(true); setErr(''); setRef(''); setHash('')
    try {
      close.current?.()
      setOpen(true)
      close.current = await openMoneyGram(box.current, address, {
        onPaid: (h) => { setHash(h); refresh() },
        onComplete: (r) => { setRef(r || '(no reference returned)'); refresh() },
        onError: (m) => setErr(m),
      }, mode)
    } catch (e) {
      setOpen(false)
      setErr(messageErreur(e))
    } finally {
      setBusy(false)
    }
  }

  const stop = () => { close.current?.(); close.current = null; setOpen(false) }

  return (
    <div className="co-card">
      <b><Landmark className="v-ic" /> {cashIn ? 'Cash in with MoneyGram' : 'Real cash out with MoneyGram'} <span className="tag">Sandbox · testnet</span></b>
      <span className="muted">{cashIn
        ? 'Pay cash at a MoneyGram location and receive Circle USDC in your wallet. No real money moves in the sandbox.'
        : 'Uses the Circle testnet USDC you borrow on UnlockShares (or free on faucet.circle.com). No real money moves in the sandbox.'}</span>
      <div className="co-kv">
        <span>USDC (Circle) in wallet</span>
        <b>{usdc === undefined ? '…' : usdc === null ? 'No USDC trustline yet' : usdc.toLocaleString('en-US', { maximumFractionDigits: 2 })}</b>
      </div>
      <div className="chips">
        {usdc === null ? (
          <button className="btn primary" onClick={() => void trust()} disabled={busy}>{busy ? <LoaderCircle className="i spin" /> : null}Add USDC trustline</button>
        ) : open ? (
          <button className="btn" onClick={stop}>Close MoneyGram</button>
        ) : (
          <button className="btn primary" onClick={() => void start()} disabled={busy || (!cashIn && !usdc)}>{busy ? <LoaderCircle className="i spin" /> : null}{cashIn ? 'Cash in with MoneyGram' : 'Cash out with MoneyGram'}</button>
        )}
        {!cashIn && <a className="btn" href="https://faucet.circle.com" target="_blank" rel="noreferrer">Get test USDC</a>}
      </div>
      {err && <p className="co-err"><TriangleAlert className="v-ic" />{err}</p>}
      {hash && <small className="muted">USDC sent to MoneyGram · <a href={lienTx(hash)} target="_blank" rel="noreferrer">see the transaction</a></small>}
      {ref && <p className="co-ok"><Check className="v-ic" />MoneyGram reference number: <code>{ref}</code></p>}
      {/* Hauteur EXPLICITE obligatoire : l'iframe du SDK fait height:100%, sinon elle retombe à 150 px. Le widget peut ensuite l'ajuster (RAMPS_HEIGHT). */}
      <div ref={box} style={{ display: open ? 'block' : 'none', height: 'min(680px, 85vh)', borderRadius: 16, overflow: 'hidden' }} />
    </div>
  )
}
