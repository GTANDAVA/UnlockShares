# UnlockShares — Borrow without selling (Stellar testnet)

**▶ Live app: https://unlockshares.vercel.app** (create an account with Face ID / fingerprint, or use the Varial wallet extension set to **Testnet**)

UnlockShares lets you borrow dollars (USDC) against tokenized shares (tAAPL) on Stellar / Soroban, instead of selling them.
Everything runs on **Stellar testnet**: tokens have no value.

## The problem

People who hold shares and need cash (an emergency, a cash advance, a deposit) often have to **sell**: they lose their position and any future gain, and may pay tax on the sale.

## The idea

Lock the shares as a guarantee, receive up to **50 %** of their value in USDC, pay back whenever you want.
If the share price falls and the loan goes above **80 %** of the guarantee's value, anyone can step in as **liquidator**: they pay back part of the debt and receive shares worth that amount **+ 5 %**, which brings the loan back to **60 %**. Above about 95 %, the whole debt is paid and the liquidator receives at most all the guarantee.
Lenders put USDC in the pool and earn the interest paid by borrowers (rates follow how much of the pool is borrowed).

## How it works on Stellar

```
 Passkey account or Varial ──signs──▶ Soroban contracts (testnet)
        │                  ├─ pret         lending pool: lend, deposit shares, borrow, repay, liquidate
        │                  ├─ oracle-prix  Apple price (SEP-40 interface), fed by 2 price robots
        │                  ├─ robinet      faucet: test shares (tAAPL) for new users
        │                  └─ distributeur dispenser: a little test USDC per day
        │                         │
        │                  Stellar Asset Contracts (SAC): tAAPL (collateral), USDC (lent token)
        ▼
 Web app (Vite + React + TypeScript): reads with RPC simulations (free), writes with signed transactions,
 history from contract events, balances from Horizon. Optional MoneyGram Ramps (sandbox) for cash in / cash out.
```

- Collateral and lent tokens are **classic Stellar assets** used in Soroban through their SAC.
- The app **reads the token names from the contract** (`jetons()` then the SAC `name()`), so nothing is hard-coded.
- Amounts are shown in dollars with the explicit assumption **1 USDC = 1 dollar**.

## Contracts and tokens (testnet)

| Item | Address |
|---|---|
| **Lending pool used by the live app** (v3, Circle testnet USDC, real Apple price) | [`CCOM4RD25IFM76BXEKQUV4ZLF4AIDIK7XGANGA6FRJQUUWE7R3Q4EUHI`](https://stellar.expert/explorer/testnet/contract/CCOM4RD25IFM76BXEKQUV4ZLF4AIDIK7XGANGA6FRJQUUWE7R3Q4EUHI) |
| **Apple price oracle** (SEP-40 interface) | [`CCA3MJ2G6JOYE3BY5QRHSXZ4B5WQ232OF7WV3JLNVRJ5CB6QEP7P4OMI`](https://stellar.expert/explorer/testnet/contract/CCA3MJ2G6JOYE3BY5QRHSXZ4B5WQ232OF7WV3JLNVRJ5CB6QEP7P4OMI) |
| **Faucet used by the live app** (2 tAAPL per hour) | [`CD3MLCLA2SQHC2X7P3W6PRNHJTZVMT5ELHS2MXT6GOFVAPXRIJVFBNH7`](https://stellar.expert/explorer/testnet/contract/CD3MLCLA2SQHC2X7P3W6PRNHJTZVMT5ELHS2MXT6GOFVAPXRIJVFBNH7) |
| Previous pool (v2), still online | [`CCWKS7YCP62XJI6B523JLUGNQMOYXES2RD56LYKHGIDL4U2REWPTDHOK`](https://stellar.expert/explorer/testnet/contract/CCWKS7YCP62XJI6B523JLUGNQMOYXES2RD56LYKHGIDL4U2REWPTDHOK) |
| Previous pool (v1, USDC), still online | [`CAMRWYRLSSFF5VJB6FKZSJO3QG3CQQDMJS77LTY3E5H7C67R2NYMUDVQ`](https://stellar.expert/explorer/testnet/contract/CAMRWYRLSSFF5VJB6FKZSJO3QG3CQQDMJS77LTY3E5H7C67R2NYMUDVQ) |
| Older pool (v1, tUSDC), still online | [`CC2IWLMTGP3F4WG4TOYOCE7ZOYD4KRE4R4AXPTVUWX6UWGUK2ID564BS`](https://stellar.expert/explorer/testnet/contract/CC2IWLMTGP3F4WG4TOYOCE7ZOYD4KRE4R4AXPTVUWX6UWGUK2ID564BS) |
| Previous faucet (v1) | [`CBM2U75GMZKML2AO2E44YXU5QGQBAOFGIJFKSRR7FP4CZUKH3HTC4XTV`](https://stellar.expert/explorer/testnet/contract/CBM2U75GMZKML2AO2E44YXU5QGQBAOFGIJFKSRR7FP4CZUKH3HTC4XTV) |
| USDC dispenser (distributeur) | [`CAMCKH3GBDEPO7ONTAMIRYJ7YCZWYT3G7F6Q33L2KEPLF7AFIB43A275`](https://stellar.expert/explorer/testnet/contract/CAMCKH3GBDEPO7ONTAMIRYJ7YCZWYT3G7F6Q33L2KEPLF7AFIB43A275) |
| tAAPL (collateral, SAC) | [`CDB64RA3FX4WYKWLBKGNJ5OB4NE454CPCDTG2AT3WJF7JMGT4VPDJFXS`](https://stellar.expert/explorer/testnet/contract/CDB64RA3FX4WYKWLBKGNJ5OB4NE454CPCDTG2AT3WJF7JMGT4VPDJFXS) |
| USDC (Circle testnet, SAC) | [`CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`](https://stellar.expert/explorer/testnet/contract/CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA) |
| **v2 test pool** (isolated, test tokens TAAPLS / USDS) | [`CDNTTZ5FLJHZMS7SSVHLANR6W7RBXT4RWDYU2XSY7XX7222PUFFWA33G`](https://stellar.expert/explorer/testnet/contract/CDNTTZ5FLJHZMS7SSVHLANR6W7RBXT4RWDYU2XSY7XX7222PUFFWA33G) |

The live app uses the **v3** lending pool: it reads the **real Apple price** from the oracle (two robots, Hyperliquid and Yahoo Finance, must agree within 1 %; see `robots/README.md`), and new loans pause if the price is more than 4 days old. Like v2, it adds: borrow limits (per address and per share of the pool cash), admin-only global settings, a demo price and a demo time jump **per position** (they never affect other users or the rates), and liquidation / repayment with an exact amount where any extra is returned.

## Repository

| Folder | Content |
|---|---|
| `unlockshares-app/unlockshares-app` | Soroban contracts in Rust: `pret`, `robinet`, `distributeur`, with unit tests. Testnet scripts in `scripts/`. Deployment notes in `DEPLOIEMENT.md`. |
| `unlockshares-frontend-testnet/frontend` | Web app (Vite, React, TypeScript, Varial). Serverless functions in `api/` (MoneyGram sandbox session). |

## Prerequisites

- Rust (stable) with the `wasm32v1-none` target, and the [Stellar CLI](https://developers.stellar.org/docs/tools/cli) (tested with 28.0.0)
- Node.js 22 or later
- The Varial browser extension (formerly Freighter), set to Testnet

## Install and run

```bash
# Contracts: tests and build
cd unlockshares-app/unlockshares-app
cargo test
stellar contract build

# Web app
cd ../../unlockshares-frontend-testnet/frontend
npm ci
npm run dev                       # uses .env / .env.local (public testnet addresses)
npm run dev -- --mode staging-v2  # same app on the isolated v2 test pool
```

Without contract addresses, the app runs in **demo mode** with simulated data (Léa's story).
See [TESTING.md](TESTING.md) for all tests and the on-chain scenario.

## Suggested path for a juror (about 5 minutes)

1. Open the app, connect Varial (Testnet), click **Get test tokens**.
2. **Borrow**: use your shares as a guarantee, then receive USDC.
3. **Activity**: every operation with its link to stellar.expert.
4. **Liquidations**: positions above 80 % can be liquidated by anyone.
5. **Presentation**: the story and the numbers behind the product.

## Proofs on testnet

All hashes below were checked on Horizon testnet (`successful: true`).

| What | Transaction |
|---|---|
| Demo tools switched off on the live pool `CAMR…UDVQ` | [`47017dbeeeb70efba16bdb5e3310dd249e5272da6e2ee97004b7b8b461ce270b`](https://stellar.expert/explorer/testnet/tx/47017dbeeeb70efba16bdb5e3310dd249e5272da6e2ee97004b7b8b461ce270b) |
| Demo tools switched off on the older pool `CC2I…64BS` | [`0a4a54f38d5f439a20da212112b50ecd5cf2bc3942011534bb9476652d0aa3c5`](https://stellar.expert/explorer/testnet/tx/0a4a54f38d5f439a20da212112b50ecd5cf2bc3942011534bb9476652d0aa3c5) |
| v2 test pool: personal demo price set by one borrower | [`ec472311e2630524ab48081aa612ba505cc3c88f99de2e9e672dfec9bcf53c8c`](https://stellar.expert/explorer/testnet/tx/ec472311e2630524ab48081aa612ba505cc3c88f99de2e9e672dfec9bcf53c8c) |
| v2 test pool: liquidation of account A by account B (script) | [`cb867eb16b667db113cf76b73d3e2d70f1a854f50ba122bd92ab205cdcb7a84c`](https://stellar.expert/explorer/testnet/tx/cb867eb16b667db113cf76b73d3e2d70f1a854f50ba122bd92ab205cdcb7a84c) |
| v2 test pool: personal time jump (1 year) on one position only | [`ce24308a9efa0cd3c351c66713d8abeb3ae0818864f9fffe4f486673e239cee4`](https://stellar.expert/explorer/testnet/tx/ce24308a9efa0cd3c351c66713d8abeb3ae0818864f9fffe4f486673e239cee4) |
| v2 test pool: liquidation of a loan opened from the web app with Varial | [`5485c9a6d04c7995e4e687ffc8efebf3f25a42841a88932aa79d9884595f52c8`](https://stellar.expert/explorer/testnet/tx/5485c9a6d04c7995e4e687ffc8efebf3f25a42841a88932aa79d9884595f52c8) |

## What is real, demo, simulated or planned

| Feature | Status |
|---|---|
| Lend, deposit shares, borrow, repay, withdraw, liquidate | **Real** (testnet transactions signed in Varial) |
| Interest rates following pool usage, protocol reserve | **Real** (computed by the contract) |
| Activity history with proofs | **Real** (contract events) |
| Test tokens (faucet, USDC dispenser) | **Real** testnet tokens, no value |
| Share price | **Real**: Apple price reported by two free robots to an on-chain oracle (SEP-40 interface); free sources, no service guarantee |
| Demo price / time jump | **Demo**: they apply to your own position only, never to other users or the rates (switched off on the previous v1 pools) |
| Cash in / cash out with MoneyGram | **Partial**: real MoneyGram Ramps sandbox session; cash deposit and pickup cannot be completed on testnet |
| Bank transfer (cash out) | **Simulation** (fixed demo rate 1 USDC = 0.92 €, nothing is sent) |
| Léa's story (no wallet connected) | **Simulation** |
| Professional price oracle (e.g. Reflector), more assets | **Planned** — see the in-app page “Path to real” |

## Limitations

- Testnet only. The Apple price comes from free sources (no service guarantee): if they stop, the price freezes and new loans pause after 4 days.
- The previous v1 and v2 pools stay online so that their users can close their positions.
- Contracts have unit tests but no external audit.

## More

- [TESTING.md](TESTING.md): how everything is tested
- [PRIOR_WORK.md](PRIOR_WORK.md): what existed before and when
- [AI_DISCLOSURE.md](AI_DISCLOSURE.md): how AI tools were used

## License

[MIT](LICENSE) © 2026 GTANDAVA. All the code in this repository was written by its author (no code from other HackMeridian team members).

- Brand logos and names (Apple, Stellar, MoneyGram, Circle / USDC and others, some via simple-icons) are **trademarks** of their owners and are not covered by the MIT license.
- Third-party dependencies keep their own licenses (mostly MIT; also Apache-2.0, MPL-2.0 used unmodified, ISC, BSD-3-Clause, CC0).
