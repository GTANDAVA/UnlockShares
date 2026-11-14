# AI disclosure

## Tools

- **Claude Code** (Anthropic), running on Greg's computer: wrote and edited code, ran tests and builds, read the testnet, prepared scripts and commits.
- **Claude** (Anthropic), in a project conversation: planning, explanations, review of the plan with Greg.

## What was produced with AI

Facts from the git history:

- 30 of the 32 commits up to `22a923a` carry a `Co-Authored-By: Claude` trailer. The 2 others (`f1b706c`, `9fa8637`) are the GitHub initial commit and its merge.
- So most of the code, tests, scripts and documentation in this repository were written with Claude Code:
  - Soroban contracts (`pret`, `robinet`, `distributeur`) and their unit tests,
  - the web app (pages, wallet and contract calls, MoneyGram sandbox integration),
  - the testnet scripts (`scripts/staging-v2.sh`, `scripts/oc1-oc2.sh`, `scripts/staging-v2-liquidation.sh`),
  - this documentation (README, PRIOR_WORK, TESTING, this file) and the CI workflow.

No percentage is given: the history does not allow an honest estimate.

## What Greg decided, tested and signed

- **Decided**: the product direction, the scope of each step, the risk rules to keep, the v2 plan, and every action that touches the blockchain or production. Rules he set for the AI: autonomous only for local code, tests and docs; no on-chain transaction, fund move, production or Vercel change, push to `main` or licence change without his explicit OK.
- **Signed / ran himself**:
  - the two `fixer_mode_demo(false)` transactions on the v1 pools (2026-11-14),
  - the isolated v2 test deployment and scenario (`scripts/staging-v2.sh`),
  - the end-to-end test in the web app with his own Varial test account (faucet, deposit, borrow, personal demo price), then the liquidation of that loan by a second test account.
- **Tested**: he checked the app screens and reported what he saw.

## How the AI's work was checked

- `cargo test` on the contracts (41 tests) and `npm test` on the MoneyGram API (10 tests), `npm run build` and `npm run lint` on the web app.
- Every on-chain claim in the README was checked on **Horizon testnet** (`successful: true`) or by reading the contract (`marche()`, `position()`, balances).
- Bugs found this way and fixed before use, for example: a liquidation that could seize all the guarantee while leaving a small debt, and a faucet message regex that never matched.
