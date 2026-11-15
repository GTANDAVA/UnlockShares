#!/usr/bin/env bash
# E3 — Déploiement de TEST de l'oracle gratuit + prêt v3 sur Stellar testnet, ISOLÉ de la production :
# comptes neufs stg3-*, jetons de test dédiés (TAAPL3 / USD3), aucun contrat ni fonds du site touché.
# Prérequis (Git Bash, depuis unlockshares-app/unlockshares-app, branche feature/oracle-gratuit) :
#   stellar contract build
#   bash scripts/staging-v3-oracle.sh 2>&1 | tee staging-v3.log
set -uo pipefail
N="--network testnet"
W=target/wasm32v1-none/release
U=10000000
log() { printf '\n== %s\n' "$*"; }
run() {
  local out; out=$("$@" 2>&1); local code=$?
  local h; h=$(printf '%s' "$out" | grep -o 'Signing transaction: [0-9a-f]\{64\}' | tail -1 | awk '{print $3}')
  local err; err=$(printf '%s' "$out" | grep -o 'Error([A-Za-z]*, #\?[A-Za-z0-9]*)' | head -1)
  local res; res=$(printf '%s' "$out" | grep -v '^ℹ\|^✅\|^🌎\|^🔗\|^⚠\|^$' | tail -1)
  if [ $code -eq 0 ]; then echo "OK   ${h:+tx=$h }${res}"; else echo "FAIL ${err:-$res}"; fi
}
key() { stellar keys public-key "$1"; }
lire() { stellar contract invoke --id "$1" --source-account stg3-admin $N --send=no -- "${@:2}" 2>/dev/null | tail -1; }

for f in pret oracle_prix; do [ -f "$W/$f.wasm" ] || { echo "Manque $W/$f.wasm : lance d'abord « stellar contract build »"; exit 1; }; done

log "Prix réel de départ (Hyperliquid, prix oracle xyz:AAPL)"
P=$(node -e "fetch('https://api.hyperliquid.xyz/info',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'metaAndAssetCtxs',dex:'xyz'})}).then(r=>r.json()).then(([m,c])=>{const i=m.universe.findIndex(a=>a.name==='xyz:AAPL');console.log(Math.round(Number(c[i].oraclePx)*1e7))}).catch(()=>console.log(''))")
[ -n "$P" ] || { echo "Lecture Hyperliquid impossible, prix de départ 356 $"; P=$((356*U)); }
echo "prix de départ = $P (7 décimales)"

log "Comptes de test (Friendbot, XLM de test gratuits)"
for k in stg3-admin stg3-bourse stg3-continu stg3-emetteur-aapl stg3-emetteur-usd stg3-preteur stg3-a stg3-intrus; do
  stellar keys generate "$k" $N --fund --overwrite >/dev/null 2>&1 || true
  echo "$k = $(key $k)"
done

log "Jetons de test (SAC)"
EA=$(key stg3-emetteur-aapl); EU=$(key stg3-emetteur-usd)
TAAPL=$(stellar contract asset deploy --asset "TAAPL3:$EA" --source-account stg3-admin $N 2>/dev/null | tail -1)
USD=$(stellar contract asset deploy --asset "USD3:$EU" --source-account stg3-admin $N 2>/dev/null | tail -1)
echo "TAAPL3 = $TAAPL"; echo "USD3   = $USD"

log "Adaptateur de prix (2 rapporteurs, 1 %, 10 min, saut 15 %, hors séance 10 %, 30 min, 5 min)"
REG="{\"tolerance_bps\":\"100\",\"fenetre_s\":600,\"saut_max_bps\":\"1500\",\"ecart_hors_seance_bps\":\"1000\",\"silence_bourse_s\":1800,\"intervalle_min_s\":300,\"bande_min\":\"$((1*U))\",\"bande_max\":\"$((10000*U))\"}"
ORA=$(stellar contract deploy --wasm $W/oracle_prix.wasm --source-account stg3-admin $N -- --admin stg3-admin --rapporteur_bourse stg3-bourse --rapporteur_continu stg3-continu --actif AAPL --prix_initial $P --reglages "$REG" 2>/dev/null | tail -1)
echo "ORACLE = $ORA"
echo "lastprice: $(lire $ORA lastprice --asset '{"Other":"AAPL"}')"

log "Prêt v3 (plafond 50, 20 % de la caisse, démo perso active) branché sur l'adaptateur"
PRET=$(stellar contract deploy --wasm $W/pret.wasm --source-account stg3-admin $N -- --admin stg3-admin --jeton_garantie $TAAPL --jeton_pret $USD --prix $((100*U)) --plafond_fixe $((50*U)) --plafond_caisse_bps 2000 --demo_perso true 2>/dev/null | tail -1)
echo "PRET = $PRET"
run stellar contract invoke --id $PRET --source-account stg3-admin $N -- fixer_oracle --oracle "[\"$ORA\",{\"Other\":\"AAPL\"}]"
echo "marche: $(lire $PRET marche)"

log "Prêteur : 200 USD3 dans le pool ; testeur A : 2 TAAPL3 en garantie"
run stellar tx new change-trust --source-account stg3-preteur $N --line "USD3:$EU"
run stellar contract invoke --id $USD --source-account stg3-emetteur-usd $N -- mint --to $(key stg3-preteur) --amount $((200*U))
run stellar contract invoke --id $PRET --source-account stg3-preteur $N -- fournir --preteur stg3-preteur --montant $((200*U))
run stellar tx new change-trust --source-account stg3-a $N --line "TAAPL3:$EA"
run stellar tx new change-trust --source-account stg3-a $N --line "USD3:$EU"
run stellar contract invoke --id $TAAPL --source-account stg3-emetteur-aapl $N -- mint --to $(key stg3-a) --amount $((2*U))
run stellar contract invoke --id $PRET --source-account stg3-a $N -- deposer --emprunteur stg3-a --montant $((2*U))
echo "A emprunte 30 au prix de l'oracle -> OK:"; run stellar contract invoke --id $PRET --source-account stg3-a $N -- emprunter --emprunteur stg3-a --montant $((30*U))

log "Sécurités (doivent toutes échouer)"
echo "L'admin fixe le prix du prêt -> NonAutorise:"; run stellar contract invoke --id $PRET --source-account stg3-admin $N -- fixer_prix --prix $((1*U))
echo "Un intrus vote -> NonAutorise:";              run stellar contract invoke --id $ORA --source-account stg3-intrus $N -- soumettre --rapporteur stg3-intrus --prix $P
echo "L'admin devient rapporteur -> AdminRapporteur:"; run stellar contract invoke --id $ORA --source-account stg3-admin $N -- changer_rapporteur --role Bourse --adresse stg3-admin
echo "Vote trop tôt (< 5 min) -> Refuse(3) attendu ensuite:"
run stellar contract invoke --id $ORA --source-account stg3-bourse $N -- soumettre --rapporteur stg3-bourse --prix $((P + U/2))
run stellar contract invoke --id $ORA --source-account stg3-continu $N -- soumettre --rapporteur stg3-continu --prix $((P + U))

log "Attente 5 min 10 s (délai minimum entre deux prix)"
sleep 310

log "Deux témoins d'accord (+0,50 $ et +1,00 $) -> Accepte(moyenne)"
run stellar contract invoke --id $ORA --source-account stg3-bourse $N -- soumettre --rapporteur stg3-bourse --prix $((P + U/2))
run stellar contract invoke --id $ORA --source-account stg3-continu $N -- soumettre --rapporteur stg3-continu --prix $((P + U))
echo "lastprice: $(lire $ORA lastprice --asset '{"Other":"AAPL"}')"
echo "prix vu par le prêt: $(lire $PRET marche | grep -o '"prix":"[0-9]*"')"

log "Adresses (à garder)"
echo "ORACLE=$ORA"; echo "PRET=$PRET"; echo "TAAPL3=$TAAPL"; echo "USD3=$USD"
echo "Rapporteur bourse (Yahoo) = $(key stg3-bourse)"; echo "Rapporteur continu (Hyperliquid) = $(key stg3-continu)"
