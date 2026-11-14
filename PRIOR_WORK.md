# Prior work

Only verifiable facts from this repository's git history. Dates are commit dates (local time, UTC+1).

## Start of the repository

- First commit: `5d0835d`, 2026-11-08 00:17 — "UnlockShares: Soroban lending contracts + testnet frontend".
  It already contained the Soroban lending and faucet contracts and the testnet web app.
- Every commit in this repository has the same git author: `GTANDAVA`.

## Dated commits

| Commit | Date | Summary |
|---|---|---|
| `5d0835d` | 2026-11-08 00:17 | Soroban lending contracts + testnet frontend |
| `f1b706c` | 2026-11-08 00:19 | Initial commit (GitHub) |
| `9fa8637` | 2026-11-08 00:19 | Merge GitHub initial commit |
| `74573ba` | 2026-11-08 10:21 | Vercel deployment config + public testnet contract addresses |
| `175d955` | 2026-11-08 11:11 | Activity page reads every 10k-ledger RPC window |
| `d26cda7` | 2026-11-08 11:26 | Freighter renamed Varial in the UI |
| `211fad0` | 2026-11-08 12:16 | "All rights reserved" notice |
| `38f4389` | 2026-11-08 12:51 | README links to the live app |
| `3a2e01a` | 2026-11-14 10:32 | Cash out: MoneyGram Ramps widget (sandbox) + session API |
| `65a4889` | 2026-11-14 10:34 | MoneyGram: tokenAddress and memo |
| `4de73f5` | 2026-11-14 11:04 | MoneyGram widget height |
| `1531775` | 2026-11-14 11:18 | Cash out layout |
| `348cd27` | 2026-11-14 11:30 | Lending pool in Circle testnet USDC |
| `15ffaa9` | 2026-11-14 12:03 | Add money: MoneyGram cash-in + SEP-24 anchor deposit |
| `b9e6b87` | 2026-11-14 12:15 | Activity: deposits and cash-outs history |
| `bd43311` | 2026-11-14 12:23 | MoneyGram cash-in deposit reference |
| `5f474a5` | 2026-11-14 12:45 | USDC dispenser contract + refill script |
| `5f1576a` | 2026-11-14 12:53 | Cash out: MoneyGram pickup vs simulated bank transfer |
| `7968051` | 2026-11-14 12:59 | Simpler Add money / Cash out |
| `30179ca` | 2026-11-14 13:07 | Menu: placeholder links removed |
| `7c77e36` | 2026-11-14 13:14 | Home: position block |
| `e3c0b17` | 2026-11-14 16:33 | Home: position card style |
| `f8b3e12` | 2026-11-14 17:27 | MoneyGram API hardening |
| `0cf9676` | 2026-11-14 17:33 | Contracts v2: borrow limits, per-user demo, admin-only settings |
| `f06c1a5` | 2026-11-14 17:34 | Stale test snapshots removed |
| `ef53df7` | 2026-11-14 17:50 | v2: exact-amount liquidation and repayment |
| `bc7c48b` | 2026-11-14 18:02 | v2: no liquidation that leaves debt without guarantee |
| `23aa4bc` | 2026-11-14 18:15 | Frontend: opt-in v2 contract |
| `7e89b25` | 2026-11-14 18:23 | Frontend v2: demo price capped, staging config |
| `0c79c4a` | 2026-11-14 18:34 | Frontend v2: liquidator balance message |
| `5b9610b` | 2026-11-14 18:51 | Dollars display, Liquidations page, placeholder pages removed |
| `22a923a` | 2026-11-14 19:00 | Token names read from the contract, v2 events in Activity |

Later commits on the branch are listed by `git log`.

## Placeholders left for "another team member"

Before commit `5b9610b`, the app had placeholder pages whose code comments said they would be built by a teammate:

- `src/pages/LiquidationPage.tsx` and `src/pages/HelpPage.tsx`: "Emplacement réservé : la page est construite par le camarade (prompt 3)." Both only showed "Page en cours de construction par un autre membre de l'équipe."
- The "Evaluate" page used a simulated (mock) risk API.

These pages contained no teammate code. They were removed in `5b9610b`; the real liquidation feature is the new **Liquidations** page.

## To be completed by Greg (HackMeridian submission)

<!-- Work done before the hackathon, team members, what was built during the event. -->
