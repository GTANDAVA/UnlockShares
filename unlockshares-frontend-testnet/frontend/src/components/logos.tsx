// Logos des tokens (marques Apple, BlackBerry, Stellar : tracés du paquet simple-icons, licence CC0).
// USDC est dessiné ici (cercle bleu, $ entre deux arcs) car simple-icons ne l'inclut pas.
import { siAmd, siAnthropic, siApple, siBlackberry, siCoinbase, siGoogle, siIntel, siMeta, siNokia, siNvidia, siSpacex, siStellar, siTesla } from 'simple-icons'

export type TokenKind = 'usdc' | 'aapl' | 'spy' | 'bb' | 'ewy' | 'xlm' | 'nvda' | 'tsla' | 'nok' | 'googl' | 'meta' | 'intc' | 'amd' | 'coin' | 'ant' | 'spcx' | 'other'

/** Logo d'une action à partir de son ticker (AAPL → aapl) ; null si on n'en a pas */
export function kindOf(ticker: string): TokenKind | null {
  const k = ticker.toLowerCase()
  return (['aapl', 'spy', 'bb', 'ewy', 'nvda', 'tsla', 'nok', 'googl', 'meta', 'intc', 'amd', 'coin', 'ant', 'spcx'] as const).find((x) => x === k) ?? null
}

const Brand = ({ path, title }: { path: string; title: string }) => (
  <svg viewBox="0 0 24 24" className="tok-logo" role="img" aria-label={title} fill="currentColor"><path d={path} /></svg>
)

const Usdc = () => (
  <svg viewBox="0 0 32 32" className="tok-full" role="img" aria-label="USDC">
    <circle cx="16" cy="16" r="16" fill="#2775ca" />
    <path d="M12.5 7.2a9.6 9.6 0 0 0 0 17.6M19.5 7.2a9.6 9.6 0 0 1 0 17.6" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    <text x="16" y="20.6" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff" fontFamily="Arial, sans-serif">$</text>
  </svg>
)

/** Logo d'un token ; null quand on n'en a pas (le ticker texte reste affiché) */
export function TokenLogo({ kind }: { kind: TokenKind }) {
  if (kind === 'usdc') return <Usdc />
  if (kind === 'aapl') return <Brand path={siApple.path} title="Apple" />
  if (kind === 'xlm') return <Brand path={siStellar.path} title="Stellar Lumens" />
  if (kind === 'bb') return <Brand path={siBlackberry.path} title="BlackBerry" />
  if (kind === 'nvda') return <Brand path={siNvidia.path} title="Nvidia" />
  if (kind === 'tsla') return <Brand path={siTesla.path} title="Tesla" />
  if (kind === 'nok') return <Brand path={siNokia.path} title="Nokia" />
  if (kind === 'googl') return <Brand path={siGoogle.path} title="Alphabet" />
  if (kind === 'meta') return <Brand path={siMeta.path} title="Meta" />
  if (kind === 'intc') return <Brand path={siIntel.path} title="Intel" />
  if (kind === 'amd') return <Brand path={siAmd.path} title="AMD" />
  if (kind === 'coin') return <Brand path={siCoinbase.path} title="Coinbase" />
  if (kind === 'ant') return <Brand path={siAnthropic.path} title="Anthropic" />
  if (kind === 'spcx') return <Brand path={siSpacex.path} title="SpaceX" />
  return null
}

/** Logo du réseau Stellar (remplace le petit « S ») */
export const StellarLogo = () => (
  <svg viewBox="0 0 24 24" className="net" role="img" aria-label="Stellar" fill="currentColor"><path d={siStellar.path} /></svg>
)
