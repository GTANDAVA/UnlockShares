import { Check, Landmark, LoaderCircle, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { lienTx, messageErreur } from '../services/chain'
import { addUsdcTrustline, openMoneyGram, usdcBalance } from '../services/moneygram'

// Retrait réel (sandbox MoneyGram, testnet) : USDC de Circle → espèces / banque via le widget MoneyGram.
export function MoneyGramCard({ address }: { address: string }) {
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
      })
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
      <b><Landmark className="v-ic" /> Real cash out with MoneyGram <span className="tag">Sandbox · testnet</span></b>
      <span className="muted">Uses the Circle testnet USDC you borrow on UnlockShares (or free on faucet.circle.com). No real money moves in the sandbox.</span>
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
          <button className="btn primary" onClick={() => void start()} disabled={busy || !usdc}>{busy ? <LoaderCircle className="i spin" /> : null}Cash out with MoneyGram</button>
        )}
        <a className="btn" href="https://faucet.circle.com" target="_blank" rel="noreferrer">Get test USDC</a>
      </div>
      {err && <p className="co-err"><TriangleAlert className="v-ic" />{err}</p>}
      {hash && <small className="muted">USDC sent to MoneyGram · <a href={lienTx(hash)} target="_blank" rel="noreferrer">see the transaction</a></small>}
      {ref && <p className="co-ok"><Check className="v-ic" />MoneyGram reference number: <code>{ref}</code></p>}
      {/* Hauteur EXPLICITE obligatoire : l'iframe du SDK fait height:100%, sinon elle retombe à 150 px. Le widget peut ensuite l'ajuster (RAMPS_HEIGHT). */}
      <div ref={box} style={{ display: open ? 'block' : 'none', height: 'min(680px, 85vh)', borderRadius: 16, overflow: 'hidden' }} />
    </div>
  )
}
