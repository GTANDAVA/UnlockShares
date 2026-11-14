#!/usr/bin/env bash
# Suite du staging v2 : liquidation réelle de A par B sur le pool de TEST déjà déployé (comptes stg-*, jetons TAAPLS/USDS).
# Aucun contrat ni fonds de production touché. Usage : bash scripts/staging-v2-liquidation.sh
set -uo pipefail
N="--network testnet"
PRET=CA6RMFWOWZANMI4IFB55CPHYSWCK4VE4DZS556QPYQOZVZEWTBD3ZEZJ
TAAPL=CDRGNRJPBEYA26QZJVGLKGLZPXGI74MHRI5OJTJ4VU7WTVA7MWVEQQXS
USD=CDXXIGTPP2TDYMDY7UBNWUQO47XHY5DIB2PVU5JJ732QTB5DY4YPHRCD
lire() { stellar contract invoke --id "$1" --source-account stg-b $N --send=no -- "${@:2}" 2>/dev/null | tail -1; }
B=$(stellar keys public-key stg-b)
echo "AVANT  usds B=$(lire $USD balance --id $B) taapl B=$(lire $TAAPL balance --id $B)"
echo "AVANT  position A: $(lire $PRET position --emprunteur stg-a)"
MAXL=$(lire $PRET montant_liquidable --emprunteur stg-a | tr -d '"'); echo "montant liquidable A: $MAXL"
echo "== B liquide A (montant + marge 1000)"
stellar contract invoke --id $PRET --source-account stg-b $N -- liquider --liquidateur stg-b --emprunteur stg-a --montant $((MAXL+1000)) 2>&1 \
  | grep -oE 'Signing transaction: [0-9a-f]{64}|Event: Liquide.*|[Ee]rror.*' | head -5
echo "APRES  usds B=$(lire $USD balance --id $B) taapl B=$(lire $TAAPL balance --id $B)"
echo "APRES  position A: $(lire $PRET position --emprunteur stg-a)"
echo "APRES  position B: $(lire $PRET position --emprunteur stg-b)"
echo "APRES  marche: $(lire $PRET marche)"
