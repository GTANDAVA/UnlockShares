# Robots rapporteurs du prix d'Apple

Two GitHub Actions robots feed the `oracle-prix` contract (SEP-40 adapter):

| Robot | Source | When | Reporter role |
|---|---|---|---|
| A | Hyperliquid oracle price of `xyz:AAPL` (not the trade price) | 24/7 | `Continu` |
| B | Yahoo Finance chart endpoint (no key, unofficial: may change or block without notice) | NYSE session only (Mon-Fri 9:30-16:00 New York) | `Bourse` |

The contract accepts a price when both agree within 1 % inside 10 minutes (average kept).
Off-hours (no Yahoo vote for 30 min), Hyperliquid alone may move the price within ±10 % of the last price confirmed by both.

**Read-only by default.** Nothing is sent unless the repo variable `ROBOTS_ACTIFS` is `oui`.
Needed to send: variable `ORACLE_ID`, secrets `RAPPORTEUR_CONTINU_CLE`, `RAPPORTEUR_BOURSE_CLE`.

```bash
cd robots
node --test                       # offline tests (no network)
node rapporteur.mjs yahoo                     # read-only (session hours only)
FORCER_LECTURE=oui node rapporteur.mjs yahoo  # read-only test any time
node rapporteur.mjs hyperliquid               # read-only: prints the price
```

Free sources, no SLA: if one is down the price stays frozen, and the loan contract blocks new borrowing after 4 days (`PrixPerime`).
Production target: Reflector or RedStone SEP-40 feed (same interface).
