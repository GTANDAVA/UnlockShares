#!/usr/bin/env bash
# Déploiement de TEST (staging) des contrats v2 sur Stellar testnet, ISOLÉ de la production :
# comptes neufs, jetons de test dédiés (TAAPLS / USDS), aucun contrat ni fonds de production touché.
# Puis scénario complet : plafonds, permissions admin, démo perso isolée, liquidation réelle.
# Usage (Git Bash, depuis unlockshares-app/unlockshares-app) : bash scripts/staging-v2.sh
set -uo pipefail
N="--network testnet"
W=target/wasm32v1-none/release
U=10000000
log() { printf '\n== %s\n' "$*"; }
# Exécute une commande stellar ; affiche le hash de transaction s'il y en a un, le résultat, ou l'erreur de contrat.
run() {
  local out; out=$("$@" 2>&1); local code=$?
  local h; h=$(printf '%s' "$out" | grep -o 'Signing transaction: [0-9a-f]\{64\}' | tail -1 | awk '{print $3}')
  local err; err=$(printf '%s' "$out" | grep -o 'Error([A-Za-z]*, #\?[A-Za-z0-9]*)' | head -1)
  local res; res=$(printf '%s' "$out" | grep -v '^ℹ\|^✅\|^🌎\|^🔗\|^⚠\|^$' | tail -1)
  if [ $code -eq 0 ]; then echo "OK   ${h:+tx=$h }${res}"; else echo "FAIL ${err:-$res}"; fi
}
key() { stellar keys public-key "$1"; }

log "Comptes de test (Friendbot)"
for k in stg-admin stg-emetteur-aapl stg-emetteur-usd stg-preteur stg-a stg-b; do
  stellar keys generate "$k" $N --fund --overwrite >/dev/null 2>&1 || true
  echo "$k = $(key $k)"
done
run stellar tx new set-options --source-account stg-emetteur-aapl $N --set-required --set-revocable --set-clawback-enabled

log "Jetons de test (SAC)"
EA=$(key stg-emetteur-aapl); EU=$(key stg-emetteur-usd)
TAAPL=$(stellar contract asset deploy --asset "TAAPLS:$EA" --source-account stg-admin $N 2>/dev/null | tail -1)
USD=$(stellar contract asset deploy --asset "USDS:$EU" --source-account stg-admin $N 2>/dev/null | tail -1)
echo "TAAPLS = $TAAPL"; echo "USDS   = $USD"

log "Robinet v2 (2 actions, 0 dollar, 1 h)"
ROB=$(stellar contract deploy --wasm $W/robinet.wasm --source-account stg-admin $N -- --admin stg-admin --action $TAAPL --dollar $USD --montant_action $((2*U)) --montant_dollar 0 --delai 3600 2>/dev/null | tail -1)
echo "ROBINET = $ROB"
run stellar contract invoke --id $TAAPL --source-account stg-emetteur-aapl $N -- set_admin --new_admin $ROB

log "Pret v2 (prix 100, plafond 50, 20 % de la caisse, démo perso active)"
PRET=$(stellar contract deploy --wasm $W/pret.wasm --source-account stg-admin $N -- --admin stg-admin --jeton_garantie $TAAPL --jeton_pret $USD --prix $((100*U)) --plafond_fixe $((50*U)) --plafond_caisse_bps 2000 --demo_perso true 2>/dev/null | tail -1)
echo "PRET = $PRET"
run stellar contract invoke --id $ROB --source-account stg-admin $N -- autoriser --qui $PRET

log "Prêteur : 200 USDS fournis au pool"
run stellar tx new change-trust --source-account stg-preteur $N --line "USDS:$EU"
run stellar contract invoke --id $USD --source-account stg-emetteur-usd $N -- mint --to $(key stg-preteur) --amount $((200*U))
run stellar contract invoke --id $PRET --source-account stg-preteur $N -- fournir --preteur stg-preteur --montant $((200*U))
echo "marche: $(stellar contract invoke --id $PRET --source-account stg-admin $N --send=no -- marche 2>/dev/null | tail -1)"

log "Testeurs A et B : lignes de confiance, robinet, dépôt de garantie"
for t in stg-a stg-b; do
  run stellar tx new change-trust --source-account $t $N --line "TAAPLS:$EA"
  run stellar tx new change-trust --source-account $t $N --line "USDS:$EU"
  echo "robinet $t:"; run stellar contract invoke --id $ROB --source-account $t $N -- recevoir --qui $t
  run stellar contract invoke --id $PRET --source-account $t $N -- deposer --emprunteur $t --montant $((2*U))
done
echo "2e robinet A (doit échouer TropTot #1):"; run stellar contract invoke --id $ROB --source-account stg-a $N -- recevoir --qui stg-a

log "Plafonds"
echo "A emprunte 41 (> 20 % de 200 = 40) -> doit échouer #9:"; run stellar contract invoke --id $PRET --source-account stg-a $N -- emprunter --emprunteur stg-a --montant $((41*U))
echo "A emprunte 40 -> OK:";                                   run stellar contract invoke --id $PRET --source-account stg-a $N -- emprunter --emprunteur stg-a --montant $((40*U))
echo "A emprunte 9 (dette ~49, 9 <= 20 % de 160) -> OK:";      run stellar contract invoke --id $PRET --source-account stg-a $N -- emprunter --emprunteur stg-a --montant $((9*U))
echo "A emprunte 2 (dette ~51 > 50) -> doit échouer #9:";      run stellar contract invoke --id $PRET --source-account stg-a $N -- emprunter --emprunteur stg-a --montant $((2*U))
echo "B emprunte 20 -> OK:";                                   run stellar contract invoke --id $PRET --source-account stg-b $N -- emprunter --emprunteur stg-b --montant $((20*U))

log "Permissions admin (un testeur ne peut pas signer pour l'admin)"
echo "B fixe le prix global -> doit échouer:";    run stellar contract invoke --id $PRET --source-account stg-b $N -- fixer_prix --prix $((1*U))
echo "B change les plafonds -> doit échouer:";    run stellar contract invoke --id $PRET --source-account stg-b $N -- fixer_plafonds --fixe $((1000*U)) --caisse_bps 10000
echo "B coupe la démo perso -> doit échouer:";    run stellar contract invoke --id $PRET --source-account stg-b $N -- fixer_demo_perso --actif false

log "Démo perso isolée + liquidation réelle"
POS_B1=$(stellar contract invoke --id $PRET --source-account stg-b $N --send=no -- position --emprunteur stg-b 2>/dev/null | tail -1)
M1=$(stellar contract invoke --id $PRET --source-account stg-b $N --send=no -- marche 2>/dev/null | tail -1)
echo "A prix démo 101 (> référence) -> doit échouer #8:"; run stellar contract invoke --id $PRET --source-account stg-a $N -- fixer_prix_demo --emprunteur stg-a --prix $((101*U))
echo "A prix démo 25 -> OK (LTV 49/50 = 98 %):";          run stellar contract invoke --id $PRET --source-account stg-a $N -- fixer_prix_demo --emprunteur stg-a --prix $((25*U))
POS_B2=$(stellar contract invoke --id $PRET --source-account stg-b $N --send=no -- position --emprunteur stg-b 2>/dev/null | tail -1)
M2=$(stellar contract invoke --id $PRET --source-account stg-b $N --send=no -- marche 2>/dev/null | tail -1)
echo "position A: $(stellar contract invoke --id $PRET --source-account stg-a $N --send=no -- position --emprunteur stg-a 2>/dev/null | tail -1)"
[ "$POS_B1" = "$POS_B2" ] && echo "CHECK position B identique: OUI" || echo "CHECK position B identique: NON ($POS_B1 vs $POS_B2)"
[ "$M1" = "$M2" ] && echo "CHECK marché identique: OUI" || echo "CHECK marché identique: NON"
echo "B tente de liquider B (pas liquidable) -> doit échouer #4:"; run stellar contract invoke --id $PRET --source-account stg-b $N -- liquider --liquidateur stg-b --emprunteur stg-b --montant 10000000
run stellar contract invoke --id $USD --source-account stg-emetteur-usd $N -- mint --to $(key stg-b) --amount $((100*U))
CAISSE1=$(stellar contract invoke --id $PRET --source-account stg-b $N --send=no -- marche 2>/dev/null | tail -1 | grep -o '"caisse":"[0-9]*"')
MAXL=$(stellar contract invoke --id $PRET --source-account stg-b $N --send=no -- montant_liquidable --emprunteur stg-a 2>/dev/null | tail -1 | tr -d '"'); echo "montant liquidable A: $MAXL"
echo "B liquide A (montant exact) -> OK:"; run stellar contract invoke --id $PRET --source-account stg-b $N -- liquider --liquidateur stg-b --emprunteur stg-a --montant $MAXL
echo "tAAPL saisis par B: $(stellar contract invoke --id $TAAPL --source-account stg-b $N --send=no -- balance --id $(key stg-b) 2>/dev/null | tail -1)"
CAISSE2=$(stellar contract invoke --id $PRET --source-account stg-b $N --send=no -- marche 2>/dev/null | tail -1 | grep -o '"caisse":"[0-9]*"')
echo "caisse avant $CAISSE1 / après $CAISSE2"
POS_B3=$(stellar contract invoke --id $PRET --source-account stg-b $N --send=no -- position --emprunteur stg-b 2>/dev/null | tail -1)
echo "position B après liquidation de A: $POS_B3"
echo "position A après liquidation: $(stellar contract invoke --id $PRET --source-account stg-a $N --send=no -- position --emprunteur stg-a 2>/dev/null | tail -1)"

log "Temps perso isolé"
M3=$(stellar contract invoke --id $PRET --source-account stg-b $N --send=no -- marche 2>/dev/null | tail -1)
POS_A=$(stellar contract invoke --id $PRET --source-account stg-a $N --send=no -- position --emprunteur stg-a 2>/dev/null | tail -1)
echo "B avance son temps de 1 an -> OK:"; run stellar contract invoke --id $PRET --source-account stg-b $N -- avancer_temps_perso --emprunteur stg-b --secondes 31536000
M4=$(stellar contract invoke --id $PRET --source-account stg-b $N --send=no -- marche 2>/dev/null | tail -1)
POS_A2=$(stellar contract invoke --id $PRET --source-account stg-a $N --send=no -- position --emprunteur stg-a 2>/dev/null | tail -1)
echo "position B: $(stellar contract invoke --id $PRET --source-account stg-b $N --send=no -- position --emprunteur stg-b 2>/dev/null | tail -1)"
[ "$POS_A" = "$POS_A2" ] && echo "CHECK position A inchangée: OUI" || echo "CHECK position A inchangée: NON"
# Le marché peut différer seulement par les intérêts courus en temps réel entre deux lectures.
echo "marché avant: $M3"; echo "marché après: $M4"

log "Adresses"
echo "PRET=$PRET"; echo "ROBINET=$ROB"; echo "TAAPLS=$TAAPL"; echo "USDS=$USD"
