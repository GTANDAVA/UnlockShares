// Adresses des contrats déployés sur testnet (données par l'étape 7 de DEPLOIEMENT.md).
// Tout est public : ce sont des adresses, pas des secrets.
const env = import.meta.env

const v = (k: string) => String(env[k] ?? '').trim()

/** Hub & spokes : une caisse USDC, un spoke par action. Quand VITE_HUB_ID est renseigné, l'appli parle au hub. */
const hub = v('VITE_HUB_ID')

export const chain = {
  /** Contrat de prêt utilisé par l'appli : le hub s'il est configuré, sinon le pool à une seule action. */
  pret: hub || v('VITE_PRET_ID'),
  hub,
  /** Version du contrat de prêt : 1 (pools actuels, par défaut) ou 2 (plafonds, démo perso, liquidation au montant) */
  pretVersion: Number(v('VITE_PRET_VERSION')) >= 2 ? Number(v('VITE_PRET_VERSION')) : 1,
  /** Robinet : en mode hub, le robinet multi-actions (une action de test de chaque spoke, une signature) */
  robinet: (hub && v('VITE_ROBINET_ACTIONS_ID')) || v('VITE_ROBINET_ID'),
  /** Distributeur d'USDC de Circle (réserve remplie par l'admin) : facultatif */
  distributeur: v('VITE_DISTRIBUTEUR_ID'),
  /** Gardien (option) : contrat de règles et clé publique du robot qui rembourse seul */
  gardien: v('VITE_GARDIEN_ID'),
  gardienRobot: v('VITE_GARDIEN_ROBOT'),
  taapl: v('VITE_TAAPL_ID'),
  tusdc: v('VITE_TUSDC_ID'),
  emetteurAapl: v('VITE_EMETTEUR_AAPL'),
  /** Code du jeton action (TAAPL ; TAAPLS sur le pool de test v2) */
  aaplCode: v('VITE_AAPL_CODE') || 'TAAPL',
  /** Jeton PRÊTÉ par le pool : code + émetteur (USDC de Circle sur le pool actuel, accepté par MoneyGram) */
  usdcCode: v('VITE_USDC_CODE') || 'TUSDC',
  emetteurUsdc: v('VITE_EMETTEUR_USDC'),
  /** Jeton dollar du robinet (tUSDC) s'il diffère du jeton prêté : il faut aussi sa trustline pour recevoir le robinet */
  emetteurTusdc: v('VITE_EMETTEUR_TUSDC'),
  rpcUrl: v('VITE_RPC_URL') || 'https://soroban-testnet.stellar.org',
  horizonUrl: v('VITE_HORIZON_URL') || 'https://horizon-testnet.stellar.org',
  friendbotUrl: 'https://friendbot.stellar.org',
  explorer: 'https://stellar.expert/explorer/testnet',
}

/** Vrai quand toutes les adresses sont renseignées : l'appli passe alors en mode testnet. */
export const chainReady = hub
  ? [chain.hub, chain.robinet, chain.emetteurUsdc].every(Boolean)
  : [chain.pret, chain.robinet, chain.taapl, chain.tusdc, chain.emetteurAapl, chain.emetteurUsdc].every(Boolean)

/** Mode hub & spokes (plusieurs actions en garantie, une position par action) */
export const hubMode = !!hub
