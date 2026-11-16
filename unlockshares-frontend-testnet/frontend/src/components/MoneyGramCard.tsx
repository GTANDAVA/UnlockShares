import { Check, LoaderCircle, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { lienTx, messageErreur } from '../services/chain'
import { addUsdcTrustline, openMoneyGram, usdcBalance, type RampMode } from '../services/moneygram'
import { tagTx } from '../services/movements'

// Widget MoneyGram (sandbox, testnet). off-ramp : USDC de Circle → espèces. on-ramp : espèces au guichet → USDC dans le wallet.
/** `onRef` : si fourni, la page affiche elle-même la référence MoneyGram (ailleurs que dans la carte). */
export function MoneyGramCard({ address, mode = 'off-ramp', onRef }: { address: string; mode?: RampMode; onRef?: (ref: string) => void }) {
  const cashIn = mode === 'on-ramp'
  const box = useRef<HTMLDivElement>(null)
  const close = useRef<(() => void) | null>(null)
  const lastHash = useRef('')
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
        onPaid: (h) => { setHash(h); lastHash.current = h; tagTx(h, { kind: 'mg-out' }); refresh() },
        onComplete: (r) => { const v = r || (cashIn ? 'see “Compte #” in the widget' : '(no reference returned)'); setRef(v); onRef?.(v); if (lastHash.current && r) tagTx(lastHash.current, { kind: 'mg-out', ref: r }); refresh() },
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
      <span className="muted">{cashIn ? 'Choose a MoneyGram location, pay cash there, receive USDC.' : 'Send USDC, collect cash at MoneyGram with your reference number.'}</span>
      <div className="chips">
        {usdc === null ? (
          <button className="btn primary" onClick={() => void trust()} disabled={busy}>{busy ? <LoaderCircle className="i spin" /> : null}Add USDC trustline</button>
        ) : open ? (
          <button className="btn" onClick={stop}>Close MoneyGram</button>
        ) : (
          <button className="btn primary" onClick={() => void start()} disabled={busy || (!cashIn && !usdc)}>{busy ? <LoaderCircle className="i spin" /> : null}{cashIn ? 'Cash in with MoneyGram' : 'Cash out with MoneyGram'}</button>
        )}
      </div>
      {err && <p className="co-err"><TriangleAlert className="v-ic" />{err}</p>}
      {hash && <small className="muted">USDC sent to MoneyGram · <a href={lienTx(hash)} target="_blank" rel="noreferrer">see the transaction</a></small>}
      {ref && !onRef && <p className="co-ok"><Check className="v-ic" />{cashIn ? 'MoneyGram deposit reference' : 'MoneyGram reference number'}: <code>{ref}</code></p>}
      {/* Hauteur EXPLICITE obligatoire : l'iframe du SDK fait height:100%, sinon elle retombe à 150 px. Le widget peut ensuite l'ajuster (RAMPS_HEIGHT). */}
      <div ref={box} style={{ display: open ? 'block' : 'none', height: 'min(680px, 85vh)', borderRadius: 16, overflow: 'hidden' }} />
    </div>
  )
}
