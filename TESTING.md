# Testing

Four levels: contract unit tests, web app checks, an on-chain scenario on an isolated test pool, and a manual end-to-end test with a real wallet.
The CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs the first two on every push and pull request: `cargo test`, then `npm test`, `npm run lint` and `npm run build`.
The wasm build (`stellar contract build`) needs the Stellar CLI and stays a manual step.

## 1. Contract unit tests (Rust, Soroban test environment)

```bash
cd unlockshares-app/unlockshares-app
cargo test
```

41 tests (last run 2026-11-14: **41 passed**).

| Contract | Tests | What they check |
|---|---|---|
| `pret` (lending pool) | 32 | Lend / withdraw; deposit shares, borrow up to 50 %, refusals (too much, empty cash, zero amount); repay then withdraw; interest second by second and the kinked rate curve; reserve cannot be borrowed; interest can make a loan liquidable; partial liquidation back to 60 %, total above ~95 %; liquidation with an exact amount (extra returned, never debt left without guarantee); repaying more than the debt returns the extra; **v2**: per-address and per-cash borrow limits, admin-only price / limits / rate settings, per-position demo price and time jump that never touch other users or the rates, real liquidation at a demo price without emptying the pool cash, demo tools switched off by the admin |
| `robinet` (faucet) | 5 | Authorizes and sends test shares, once per hour, admin can authorize a contract, v2 amounts (2 shares, no dollar) |
| `distributeur` (USDC dispenser) | 4 | Sends 20 USDC, once per day, empty reserve, admin changes the amount and withdraws |

Test snapshots are written to `contracts/*/test_snapshots/`.

## 2. Web app

```bash
cd unlockshares-frontend-testnet/frontend
npm ci
npm test        # 10 tests: MoneyGram API security (wallet-signed challenge, origin allowlist, rate limit, sandbox-only key)
npm run lint    # oxlint
npm run build   # TypeScript type check + production build
```

Last run 2026-11-14: tests **10 passed**, lint **0 errors**, build OK.

## 3. On-chain scenario on an isolated v2 test pool (testnet)

Uses **new test accounts and dedicated test tokens only** (TAAPLS, USDS): no existing contract or fund is touched.
It needs the Stellar CLI and signs testnet transactions, so it is run by a person, not by the CI.

```bash
cd unlockshares-app/unlockshares-app
stellar contract build
bash scripts/staging-v2.sh 2>&1 | tee staging-v2.log
```

Each step prints `OK tx=…` or `FAIL Error(Contract, #n)`; some failures are expected.

| Step | Expected | Result 2026-11-14 |
|---|---|---|
| Faucet twice within an hour | 2nd refused (`#1`) | ✅ |
| Borrow 41 when 20 % of the cash is 40 | refused (`#9`) | ✅ |
| Borrow 40, then 9 | OK | ✅ |
| Borrow 2 more (debt above 50 per address) | refused (`#9`) | ✅ |
| A test user calls admin functions (price, limits, demo switch) | refused (no admin signature) | ✅ (refused by the CLI before reaching the contract; the contract rule is covered by unit tests) |
| Demo price above the reference price | refused (`#8`) | ✅ |
| Demo price 25 for A | A becomes liquidable; B's position and the market price unchanged | ✅ |
| B liquidates B (not liquidable) | refused (`#4`) | ✅ |
| B liquidates A (amount + small margin) | A's debt and guarantee at 0, B receives the shares, the extra is returned | ✅ tx `cb867eb16b667db113cf76b73d3e2d70f1a854f50ba122bd92ab205cdcb7a84c` |
| B jumps 1 year in its own time | interest on B only; A and the market unchanged | ✅ tx `ce24308a9efa0cd3c351c66713d8abeb3ae0818864f9fffe4f486673e239cee4` |

Test pool: `CDNTTZ5FLJHZMS7SSVHLANR6W7RBXT4RWDYU2XSY7XX7222PUFFWA33G`.

## 4. Manual end-to-end test with a wallet

```bash
cd unlockshares-frontend-testnet/frontend
npm run dev -- --mode staging-v2   # app on the v2 test pool, http://localhost:5173
```

With a **new** Varial test account on Testnet:

1. Connect Varial, **Get test tokens** (trustlines + 2 test shares).
2. Home: **Use as guarantee** (2 shares), **Borrow** 30.
3. Demo controls: set **your** demo price to 15, apply → the loan becomes liquidable (100 %).
4. Liquidations: your loan is listed first. If you only hold the borrowed 30, the app explains you cannot cover debt + interest.
5. A second account liquidates the loan → debt and guarantee at 0; other positions unchanged.
6. Activity: every step with its stellar.expert link.

Run on 2026-11-14 with account `GCAOIADX6FZ7O2OSFXHFBSSUCZMG7IIJDWXTB5EMWTA7WG2W5EYW3QD3`: steps 1 to 3 from the app, step 5 by a second test account (tx `5485c9a6d04c7995e4e687ffc8efebf3f25a42841a88932aa79d9884595f52c8`). ✅

## 5. Full redeploy script (dry run)

`unlockshares-app/unlockshares-app/scripts/redeploy-testnet.sh` rebuilds everything after a testnet reset. Without `--executer` it only prints the commands (no transaction).

Last dry run 2026-11-15: all steps printed, SAC addresses derived correctly (tAAPL `CDB6…JFXS`, USDC `CBIE…DAMA`), no transaction sent (checked on Horizon). ✅

## Not yet tested

- A test by someone outside the team, on a fresh browser and wallet, without help.
- The full path on the live app with the v2 contracts and Circle USDC (to do right after the switch, with a fresh Varial account).
