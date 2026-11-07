# UnlockShares — Borrow without selling (Stellar testnet)

Emprunter des USDC en gardant ses actions tokenisées (AAPL) en garantie, sur Stellar / Soroban.

| Dossier | Contenu |
|---|---|
| `unlockshares-app/unlockshares-app` | Contrats Soroban (Rust) : `pret` (prêt / garantie / liquidation) et `robinet` (jetons de test). Voir `DEPLOIEMENT.md`. |
| `unlockshares-frontend-testnet/frontend` | Application web (Vite + React + TypeScript) avec Freighter : Earn, Borrow, Cash out (off-ramp SEP-24 simulé), Activity, Presentation. |

## Lancer le frontend

```bash
cd unlockshares-frontend-testnet/frontend
npm install
cp .env.example .env   # adresses publiques des contrats testnet
npm run dev
```

Sans adresses de contrats dans `.env`, l'application tourne en mode démo (données simulées).
