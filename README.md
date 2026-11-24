# UnlockShares — Borrow without selling (Stellar testnet)

**▶ Live app: https://unlockshares.vercel.app** (works on phone and computer: create an account with Face ID / fingerprint, no extension and no XLM needed, or use the Varial wallet extension set to **Testnet**)

UnlockShares lets you borrow dollars (USDC) against **12 tokenized shares** (Apple, Amazon, Nvidia, Circle, Intel, SpaceX, Anthropic, AMD, Coinbase, IBM, Nokia, BlackBerry) on Stellar / Soroban, instead of selling them. The money can stay in your wallet, go to your bank account, be picked up in cash, or pay a merchant (also in 3 instalments). An optional **guardian** pays part of your loan back by itself while you sleep.
Everything runs on **Stellar testnet**: tokens have no value.

## The problem

People who hold shares and need cash (an emergency, a cash advance, a deposit) often have to **sell**: they lose their position and any future gain, and may pay tax on the sale.

## The idea

Lock the shares as a guarantee, receive up to **50 %** of their value in USDC, pay back whenever you want.
If the share price falls and the loan goes above **80 %** of the guarantee's value, anyone can step in as **liquidator**: they pay back part of the debt and receive shares worth that amount **+ 5 %**, which brings the loan back to **60 %**. Above about 95 %, the whole debt is paid and the liquidator receives at most all the guarantee.
Lenders put USDC in **one shared pool (the hub)** and earn the interest paid by borrowers (rates follow how much of the pool is borrowed, plus a risk premium per share). Each share is a separate **spoke** with its own rules and price: if one share collapses, only the loans against that share can be sold.

## How it works on Stellar

```
 Passkey account or Varial ──signs──▶ Soroban contracts (testnet)
        │                  ├─ hub (v2)        one USDC pool, 12 spokes (one per share): lend, deposit shares, borrow,
        │                  │                  borrow to a merchant, repay, repay for someone else, liquidate,
        │                  │                  guardian mandates; code upgradable in place by the admin
        │                  ├─ oracle-prix ×12 one price per share (SEP-40 interface), fed by 2 price robots
        │                  ├─ robinet-actions faucet: welcome pack (AAPL + BB + NOK) or any share on demand, once per hour
        │                  └─ gardien         policy for passkey smart accounts (first version of the guardian)
        │                         │
        │                  Stellar Asset Contracts (SAC): 12 test shares (authorization required), USDC
        ▼
 Web app (Vite + React + TypeScript): reads with RPC simulations (free), writes with signed transactions,
 history from contract events, balances from Horizon.
 Passkey accounts: smart accounts (OpenZeppelin smart-account-kit, WebAuthn); network fees paid by a fee relay
 (Vercel function api/relais wrapping OpenZeppelin Channels) that only accepts UnlockShares calls.
 Money in / out: Stellar test anchor (SEP-10 or SEP-45 sign-in, SEP-24 deposit and withdrawal),
 and MoneyGram Ramps sandbox for cash (Varial accounts).
 Robots (GitHub Actions, about every 5 minutes): 2 price reporters per share, and the guardian robot.
```

- Collateral and lent tokens are **classic Stellar assets** used in Soroban through their SAC. The 12 test shares are issued with **authorization required, revocable and clawback**, like real securities: the faucet authorizes each holder.
- **One reading of risk everywhere**: your debt as a % of your shares' value. Max borrow **50 %**, guardian steps in at **70 %** and brings the loan back to **60 %**, protection sale at **80 %**.
- Amounts are shown in dollars with the explicit assumption **1 USDC = 1 dollar**.

## The guardian (optional, off by default)

While you sleep, if a loan reaches **70 %** of the shares' value, the guardian robot pays part of it back **with the USDC already in your wallet**, down to **60 %**, within a **daily limit you choose**. It can **only pay back** (and, if you allow it, add shares as collateral): it cannot borrow, withdraw your shares or send your money anywhere else. You turn it on or off yourself, with one signature.

- Hub v2: a **mandate** given to the hub (`fixer_mandat`), for **every account** (passkey and Varial); the robot calls `rembourser_par_mandat` / `deposer_par_mandat`, capped per day by the contract.
- First version (previous hub): a policy contract on the passkey smart account (`contracts/gardien`, OpenZeppelin stellar-accounts v0.8).

## Contracts and tokens (testnet)

| Item | Address |
|---|---|
| **Hub v2 used by the live app** (one USDC pool, 12 spokes) | [`CDKTMUC7TG6FW4HUUZ4RVM76EPHLTYD6TV77NWUNOB2ADNKR7PDGNUNU`](https://stellar.expert/explorer/testnet/contract/CDKTMUC7TG6FW4HUUZ4RVM76EPHLTYD6TV77NWUNOB2ADNKR7PDGNUNU) |
| **Share faucet** (welcome pack AAPL + BB + NOK, any share on demand) | [`CDVXQTFEDN2OJBZU2AB2O4DI76RFBRWJRRMRZMNLEVNSO2BMZNAJQAUO`](https://stellar.expert/explorer/testnet/contract/CDVXQTFEDN2OJBZU2AB2O4DI76RFBRWJRRMRZMNLEVNSO2BMZNAJQAUO) |
| Guardian robot (public key) | [`GCKET4LNNPLZRV37PWFVBIDSAVNUIEDKM2QSOUKPM4DCHVUBJ3E6UND7`](https://stellar.expert/explorer/testnet/account/GCKET4LNNPLZRV37PWFVBIDSAVNUIEDKM2QSOUKPM4DCHVUBJ3E6UND7) |
| Guardian policy for passkey accounts (first version) | [`CBBKHSDHUPFSKACFWMZUNWV66SQJYE7D2GHMPVBASSEMRCMUOJWMCOUF`](https://stellar.expert/explorer/testnet/contract/CBBKHSDHUPFSKACFWMZUNWV66SQJYE7D2GHMPVBASSEMRCMUOJWMCOUF) |
| Test share issuer (authorization required) | [`GAJEXTHI62OQ5UCBR3RMIBLMMUDG34H5XX6MRNU3JI7VROTV2BWOLPT7`](https://stellar.expert/explorer/testnet/account/GAJEXTHI62OQ5UCBR3RMIBLMMUDG34H5XX6MRNU3JI7VROTV2BWOLPT7) |
| USDC (Circle testnet, SAC) | [`CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`](https://stellar.expert/explorer/testnet/contract/CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA) |
| USDC dispenser for testers (distributeur) | [`CAMCKH3GBDEPO7ONTAMIRYJ7YCZWYT3G7F6Q33L2KEPLF7AFIB43A275`](https://stellar.expert/explorer/testnet/contract/CAMCKH3GBDEPO7ONTAMIRYJ7YCZWYT3G7F6Q33L2KEPLF7AFIB43A275) |

<details><summary>The 12 test shares and their price oracles</summary>

| Share | Token (SAC) | Price oracle (SEP-40) |
|---|---|---|
| AAPL | [`CCVG…DUJI`](https://stellar.expert/explorer/testnet/contract/CCVGWRXVRL5QHI4GOPMHYWI4UV33XK4RSSPCLE2HI6BQEWLVZ6H5DUJI) | [`CCA3…4OMI`](https://stellar.expert/explorer/testnet/contract/CCA3MJ2G6JOYE3BY5QRHSXZ4B5WQ232OF7WV3JLNVRJ5CB6QEP7P4OMI) |
| AMZN | [`CDZR…RIZU`](https://stellar.expert/explorer/testnet/contract/CDZR5ENMOZEKYIKVJQG3IJQIBSKVHS3V7THI5XCTF5QOZ4HZICVXRIZU) | [`CB23…CILQ`](https://stellar.expert/explorer/testnet/contract/CB23ZZKTRZRQW4UD2LW7GQPRSRYUVDWBIKDQ7NAQQGJUEKIR7SXECILQ) |
| NVDA | [`CCMA…WXZR`](https://stellar.expert/explorer/testnet/contract/CCMAWM224RLIHI63BDL2FUTEOW7S2LNRWQGXN7A3A55T3Y3BPMX2WXZR) | [`CD2V…I6JB`](https://stellar.expert/explorer/testnet/contract/CD2VU3OFZDGXI3QH45RZMJCDO7JAVIOU45TV6E46JIJ3DSZ6JTIOI6JB) |
| CRCL | [`CCMP…OMBJ`](https://stellar.expert/explorer/testnet/contract/CCMPDQ5XWKOQ5Z54CAQCD2EDD7TA7FEFJLGT7ZWPWHI3GZ6VFEEWOMBJ) | [`CCLZ…43E3`](https://stellar.expert/explorer/testnet/contract/CCLZOE5WONX3APRGKAXHRGIAH3HGBSG3RQRVI2AS3FMUUAIAJF7S43E3) |
| INTC | [`CDS5…KMFF`](https://stellar.expert/explorer/testnet/contract/CDS5AJOA7JX4I2GJVP7FAYSJMY2JHOJLWFZZNJLFPDCPQHJOL3QWKMFF) | [`CDRV…4C4W`](https://stellar.expert/explorer/testnet/contract/CDRVYARB2FS4GIH4OJMXJZHQMZ63FM5Y6JPIIURRNE6JH6WM6QXG4C4W) |
| SPCX | [`CBIP…ZN4G`](https://stellar.expert/explorer/testnet/contract/CBIPNZNBE6E5OIL2GHW2JRTMNDQY5NHJNANY2UAU3JZ5LU7X2IT7ZN4G) | [`CBQ6…D7HB`](https://stellar.expert/explorer/testnet/contract/CBQ6MTTHVXZWGHSHVUE7DAR6HVC5C6CFXSIUWBB5HEG7NIWD333YD7HB) |
| ANT | [`CC35…MYIB`](https://stellar.expert/explorer/testnet/contract/CC35BV2FPKVANLIWCCRGRA2ODHFJAVAEFVETJ53WTBVW6FHCEPZOMYIB) | [`CDZ4…2KB5`](https://stellar.expert/explorer/testnet/contract/CDZ4PDIC4SUS5EILZE3S3SJ23OVNGW5D5UQK2HP3IJ7UIC6WY3SX2KB5) |
| AMD | [`CBML…EQDO`](https://stellar.expert/explorer/testnet/contract/CBMLVXL5LITCFJR7YAFOHMUAHEJKOMER2OOSFJZRLDO3RTJM43ROEQDO) | [`CBIG…P3HH`](https://stellar.expert/explorer/testnet/contract/CBIGD5RZ2MEOSXNDACVX533SFJSA5IZUXZ7J62WNYIXTROAZD6A4P3HH) |
| COIN | [`CBRI…ODAG`](https://stellar.expert/explorer/testnet/contract/CBRI6LCSY7QST64EM47AR2J6M4N5TB3KCCF7WRVGL7XVJIJDXIBCODAG) | [`CCA2…7N4Q`](https://stellar.expert/explorer/testnet/contract/CCA2KTNT7XMGSX3WJSSVQOPZHTKYLLLWUYL7DVDQUPLYXBFRTMLR7N4Q) |
| IBM | [`CD4I…IHX6`](https://stellar.expert/explorer/testnet/contract/CD4IZUYB5WZ2ZRTXPC35GGZI7PPYPBZ333CSFPXESMIZVFZQBP5RIHX6) | [`CD7F…CHU2`](https://stellar.expert/explorer/testnet/contract/CD7F3ZY5WGYR27K6FOOYK46FDZOAXDFENIB6TXJNYYH5FA7X4K3CCHU2) |
| NOK | [`CDT7…RWXZ`](https://stellar.expert/explorer/testnet/contract/CDT7FZ64T2P6537Q7DHMKSTQKEEUAIYY2N53KIUQRJG345U4FIIMRWXZ) | [`CBCJ…WOC5`](https://stellar.expert/explorer/testnet/contract/CBCJNVB5SRBSDPBCPS4XPOCKAYGEYJUTDXKHWUA3WWPTZJHY3FIBWOC5) |
| BB | [`CD4D…SEDP`](https://stellar.expert/explorer/testnet/contract/CD4DVZ4LLVJP2FGZFWJTDLMLFCJDVQOT2IDMKFNWWCD4ZHM2FZZKSEDP) | [`CAP3…CMNR`](https://stellar.expert/explorer/testnet/contract/CAP3F4PAXQQI7CQOBVBKMXLNZ2REPLCXGJX5YBAO6ARVBUA3VYDYCMNR) |

Every share: max borrow 50 %, protection sale at 80 % (+5 % to the liquidator, loan brought back to 60 %), a risk premium from +0.5 % (AAPL, AMZN, IBM) to +3 % a year (SPCX, ANT), and a cap on the share of the pool it can borrow (25 % for AAPL down to 10 %).
</details>

<details><summary>Previous contracts (paused, or kept only so that their users can close their positions)</summary>

| Item | Address |
|---|---|
| Hub v1 (all 12 spokes paused since 23/11/2026: repay and withdraw still work) | [`CAPHBREM2DX36MACGMUJWMQ7ASCBR2LFJRCJQIEEUMQ7SI5IV4TFMIKF`](https://stellar.expert/explorer/testnet/contract/CAPHBREM2DX36MACGMUJWMQ7ASCBR2LFJRCJQIEEUMQ7SI5IV4TFMIKF) |
| Single-share pool v3 (tAAPL / USDC) | [`CCOM4RD25IFM76BXEKQUV4ZLF4AIDIK7XGANGA6FRJQUUWE7R3Q4EUHI`](https://stellar.expert/explorer/testnet/contract/CCOM4RD25IFM76BXEKQUV4ZLF4AIDIK7XGANGA6FRJQUUWE7R3Q4EUHI) |
| Faucet v2 (tAAPL) | [`CD3MLCLA2SQHC2X7P3W6PRNHJTZVMT5ELHS2MXT6GOFVAPXRIJVFBNH7`](https://stellar.expert/explorer/testnet/contract/CD3MLCLA2SQHC2X7P3W6PRNHJTZVMT5ELHS2MXT6GOFVAPXRIJVFBNH7) |
| Pool v2 | [`CCWKS7YCP62XJI6B523JLUGNQMOYXES2RD56LYKHGIDL4U2REWPTDHOK`](https://stellar.expert/explorer/testnet/contract/CCWKS7YCP62XJI6B523JLUGNQMOYXES2RD56LYKHGIDL4U2REWPTDHOK) |
| Pool v1 (USDC) | [`CAMRWYRLSSFF5VJB6FKZSJO3QG3CQQDMJS77LTY3E5H7C67R2NYMUDVQ`](https://stellar.expert/explorer/testnet/contract/CAMRWYRLSSFF5VJB6FKZSJO3QG3CQQDMJS77LTY3E5H7C67R2NYMUDVQ) |
| Pool v1 (tUSDC) | [`CC2IWLMTGP3F4WG4TOYOCE7ZOYD4KRE4R4AXPTVUWX6UWGUK2ID564BS`](https://stellar.expert/explorer/testnet/contract/CC2IWLMTGP3F4WG4TOYOCE7ZOYD4KRE4R4AXPTVUWX6UWGUK2ID564BS) |
| Faucet v1 | [`CBM2U75GMZKML2AO2E44YXU5QGQBAOFGIJFKSRR7FP4CZUKH3HTC4XTV`](https://stellar.expert/explorer/testnet/contract/CBM2U75GMZKML2AO2E44YXU5QGQBAOFGIJFKSRR7FP4CZUKH3HTC4XTV) |
| tAAPL (collateral of the single-share pools) | [`CDB64RA3FX4WYKWLBKGNJ5OB4NE454CPCDTG2AT3WJF7JMGT4VPDJFXS`](https://stellar.expert/explorer/testnet/contract/CDB64RA3FX4WYKWLBKGNJ5OB4NE454CPCDTG2AT3WJF7JMGT4VPDJFXS) |
| v2 test pool (isolated, test tokens TAAPLS / USDS) | [`CDNTTZ5FLJHZMS7SSVHLANR6W7RBXT4RWDYU2XSY7XX7222PUFFWA33G`](https://stellar.expert/explorer/testnet/contract/CDNTTZ5FLJHZMS7SSVHLANR6W7RBXT4RWDYU2XSY7XX7222PUFFWA33G) |
</details>

## Repository

| Folder | Content |
|---|---|
| `unlockshares-app/unlockshares-app` | Soroban contracts in Rust: `hub` (hub v2), `oracle-prix`, `robinet-actions`, `gardien`, and the earlier `pret`, `robinet`, `distributeur`, with unit tests. Testnet scripts in `scripts/`. Deployment notes in `DEPLOIEMENT.md`. |
| `robots` | Price reporters (2 per share) and the guardian robot, run by GitHub Actions. |
| `unlockshares-frontend-testnet/frontend` | Web app (Vite, React, TypeScript, passkeys, Varial). Serverless functions in `api/`: fee relay for passkey accounts, MoneyGram sandbox session, display prices. |

## Prerequisites

- Rust (stable) with the `wasm32v1-none` target, and the [Stellar CLI](https://developers.stellar.org/docs/tools/cli) (tested with 28.0.0)
- Node.js 22 or later
- Optional: the Varial browser extension (formerly Freighter), set to Testnet. Passkey accounts need no extension.

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

## Suggested path for a first visit (about 5 minutes)

Use **https://unlockshares.vercel.app** itself (a passkey belongs to one web address: a different preview URL means a new account).

1. **Discover** (opening page): Léa's story, a short video and the FAQ.
2. **Create an account** with Face ID / fingerprint (or connect Varial on Testnet), then **Get test shares**: the welcome pack (2 AAPL, 2 BB, 2 NOK) in one signature; any other share from the Borrow page.
3. **Get cash**: pick an amount and where it goes (**wallet**, **bank account** through the Stellar test anchor, or **cash** with MoneyGram). UnlockShares locks just the shares needed and borrows from the hub.
4. **Pay**: pay a merchant straight from your borrowing capacity, or in **3 monthly instalments**. **Pay back for someone**: paste a relative's address, see their loans, repay part of one.
5. **Home → Guardian**: turn it on (one signature), then in **Demo controls** lower your share price until the loan passes 70 %: the guardian robot pays part of the loan back by itself within about 5 minutes.
6. **Activity**: every operation with its link to stellar.expert. **Liquidations**: positions above 80 % can be liquidated by anyone.

## Proofs on testnet

All hashes below were checked on Horizon testnet (`successful: true`).

| What | Transaction |
|---|---|
| Hub v2: a relative repays someone else's loan (`rembourser_pour`, 8 USDC) | [`a4c84ac1b0d50041cb2c299c9c11214f77fedb533302743375f746daf54b09e3`](https://stellar.expert/explorer/testnet/tx/a4c84ac1b0d50041cb2c299c9c11214f77fedb533302743375f746daf54b09e3) |
| Guardian robot repays a loan by itself (2.85 USDC, loan back from 74 % to 60 %, previous hub) | [`c11842441f5b202237ba7eb3b1b95227ce0aeea2f9eb523cf1cd2a7ac4bbffeb`](https://stellar.expert/explorer/testnet/tx/c11842441f5b202237ba7eb3b1b95227ce0aeea2f9eb523cf1cd2a7ac4bbffeb) |
| Hub v2: code upgraded in place by the admin, same address and data (`mettre_a_jour`) | [`15ebb56286b157863f55651a44706dc464c9bf22029452df6ab777aec3092aa7`](https://stellar.expert/explorer/testnet/tx/15ebb56286b157863f55651a44706dc464c9bf22029452df6ab777aec3092aa7) |
| Hub v2: the share faucet authorizes the hub to hold the 12 test shares | [`0e14f2a79ef9791e4e6edf2fbcce9a3ea81bd859f1e6de9c5b99485dd4c1d3fa`](https://stellar.expert/explorer/testnet/tx/0e14f2a79ef9791e4e6edf2fbcce9a3ea81bd859f1e6de9c5b99485dd4c1d3fa) |
| Hub v2: lender cash moved from the previous hub (50 USDC) | [`6d708c4c3466444f85b193304a9d188489002da1675605ed8d57751195f15e8f`](https://stellar.expert/explorer/testnet/tx/6d708c4c3466444f85b193304a9d188489002da1675605ed8d57751195f15e8f) |
| Demo tools switched off on the live pool `CAMR…UDVQ` | [`47017dbeeeb70efba16bdb5e3310dd249e5272da6e2ee97004b7b8b461ce270b`](https://stellar.expert/explorer/testnet/tx/47017dbeeeb70efba16bdb5e3310dd249e5272da6e2ee97004b7b8b461ce270b) |
| Demo tools switched off on the older pool `CC2I…64BS` | [`0a4a54f38d5f439a20da212112b50ecd5cf2bc3942011534bb9476652d0aa3c5`](https://stellar.expert/explorer/testnet/tx/0a4a54f38d5f439a20da212112b50ecd5cf2bc3942011534bb9476652d0aa3c5) |
| v2 test pool: personal demo price set by one borrower | [`ec472311e2630524ab48081aa612ba505cc3c88f99de2e9e672dfec9bcf53c8c`](https://stellar.expert/explorer/testnet/tx/ec472311e2630524ab48081aa612ba505cc3c88f99de2e9e672dfec9bcf53c8c) |
| v2 test pool: liquidation of account A by account B (script) | [`cb867eb16b667db113cf76b73d3e2d70f1a854f50ba122bd92ab205cdcb7a84c`](https://stellar.expert/explorer/testnet/tx/cb867eb16b667db113cf76b73d3e2d70f1a854f50ba122bd92ab205cdcb7a84c) |
| v2 test pool: personal time jump (1 year) on one position only | [`ce24308a9efa0cd3c351c66713d8abeb3ae0818864f9fffe4f486673e239cee4`](https://stellar.expert/explorer/testnet/tx/ce24308a9efa0cd3c351c66713d8abeb3ae0818864f9fffe4f486673e239cee4) |
| v2 test pool: liquidation of a loan opened from the web app with Varial | [`5485c9a6d04c7995e4e687ffc8efebf3f25a42841a88932aa79d9884595f52c8`](https://stellar.expert/explorer/testnet/tx/5485c9a6d04c7995e4e687ffc8efebf3f25a42841a88932aa79d9884595f52c8) |

## What is real, demo, simulated or planned

| Feature | Status |
|---|---|
| Lend, deposit shares, borrow, repay, withdraw, liquidate, on 12 shares | **Real** (testnet transactions signed with a passkey or in Varial) |
| Pay a merchant from your borrowing capacity, 3 instalments | **Real** contract function on testnet (`emprunter_vers`, unit-tested; no proof transaction listed here yet); instalments are 3 dated borrowings under the same limits |
| Repay for someone else | **Real** (`rembourser_pour`): only the payer signs, the shares stay with the borrower |
| Guardian (repay-only robot, optional) | **Real** on testnet; the robot runs on GitHub Actions about every 5 minutes (no service guarantee) |
| Hub code upgrade in place | **Real**, by the admin key alone, no delay yet (testnet choice) |
| Passkey accounts, network fees paid for the user | **Real** (testnet smart accounts; the fee relay only accepts UnlockShares calls and small USDC payments to an anchor) |
| Interest rates following pool usage, protocol reserve | **Real** (computed by the contract) |
| Activity history with proofs | **Real** (contract events) |
| Test tokens (faucet, USDC dispenser) | **Real** testnet tokens, no value |
| Share prices | **Real**: 12 market prices reported by two free robots (Hyperliquid, Yahoo Finance) to on-chain oracles (SEP-40 interface); free sources, no service guarantee |
| Demo price / time jump | **Demo**: they apply to your own position only, never to other users or the rates (switched off on the previous v1 pools) |
| Cash in / cash out with MoneyGram | **Partial**: real MoneyGram Ramps sandbox session; cash deposit and pickup cannot be completed on testnet |
| Bank transfer in and out | **Real on testnet**: Stellar test anchor `testanchor.stellar.org` (SEP-24); the USDC really moves, the bank side is the anchor's test bank |
| Léa's story (Discover page, demo mode without contract addresses) | **Simulation** |
| Professional price oracle (e.g. Reflector), real tokenized shares from their issuers | **Planned** |

## Limitations

- Testnet only. Share prices come from free sources (no service guarantee): if they stop, prices freeze and new loans pause.
- The test shares are not real shares. Real tokenized shares would need their issuer's agreement (they are authorization-required assets) and a lending licence in each country.
- The hub admin key can upgrade the code at once (no delay, no multisig yet): fine on testnet, to be hardened before real users.
- The guardian robot and the price robots run on GitHub Actions: runs can be late by a few minutes.
- Previous pools and hub v1 stay online (paused) so that their users can close their positions.
- Contracts have unit tests but no external audit.

## More

- [TESTING.md](TESTING.md): how everything is tested
- [PRIOR_WORK.md](PRIOR_WORK.md): what existed before and when
- [AI_DISCLOSURE.md](AI_DISCLOSURE.md): how AI tools were used

## License

[MIT](LICENSE) © 2026 GTANDAVA. All the code in this repository was written by its author (no code from other HackMeridian team members).

- Brand logos and names (Apple, Stellar, MoneyGram, Circle / USDC and others, some via simple-icons) are **trademarks** of their owners and are not covered by the MIT license.
- Third-party dependencies keep their own licenses (mostly MIT; also Apache-2.0, MPL-2.0 used unmodified, ISC, BSD-3-Clause, CC0).
