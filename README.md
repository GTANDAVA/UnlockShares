# UnlockShares — Borrow without selling (Stellar testnet)

**▶ Essayer l'appli en ligne : https://unlockshares.vercel.app** (extension Varial / ex-Freighter réglée sur Testnet)

Emprunter des USDC en gardant ses actions tokenisées (AAPL) en garantie, sur Stellar / Soroban.

| Dossier | Contenu |
|---|---|
| `unlockshares-app/unlockshares-app` | Contrats Soroban (Rust) : `pret` (prêt / garantie / liquidation) et `robinet` (jetons de test). Voir `DEPLOIEMENT.md`. |
| `unlockshares-frontend-testnet/frontend` | Application web (Vite + React + TypeScript) avec Varial (ex-Freighter) : Earn, Borrow, Cash out (off-ramp SEP-24 simulé), Activity, Presentation. |

## Lancer le frontend

```bash
cd unlockshares-frontend-testnet/frontend
npm install
cp .env.example .env   # adresses publiques des contrats testnet
npm run dev
```

Sans adresses de contrats dans `.env`, l'application tourne en mode démo (données simulées).

## Licence

© 2026 GTANDAVA — tous droits réservés. Code consultable, mais aucune réutilisation sans accord écrit. Voir `LICENSE`.
