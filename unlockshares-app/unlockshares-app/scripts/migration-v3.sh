#!/usr/bin/env bash
# E5 — Migration du site vers l'oracle gratuit + prêt v3 (Stellar testnet).
# SANS argument : LECTURE SEULE. Affiche l'état du pool v2 et les étapes, n'envoie rien.
# AVEC une étape (M1 … M6) : exécute CETTE étape seulement, après confirmation « oui ».
#   bash scripts/migration-v3.sh            # état + plan
#   bash scripts/migration-v3.sh M1         # une seule transaction
# Les adresses créées sont gardées dans migration-v3.ids (adresses publiques, aucun secret).
set -uo pipefail
N="--network testnet"
W=target/wasm32v1-none/release
U=10000000
ADMIN="${ADMIN:-greg}"
POOL_V2=CCWKS7YCP62XJI6B523JLUGNQMOYXES2RD56LYKHGIDL4U2REWPTDHOK
ROBINET=CD3MLCLA2SQHC2X7P3W6PRNHJTZVMT5ELHS2MXT6GOFVAPXRIJVFBNH7
TAAPL=CDB64RA3FX4WYKWLBKGNJ5OB4NE454CPCDTG2AT3WJF7JMGT4VPDJFXS
USDC=CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
IDS=migration-v3.ids
touch "$IDS"; source "$IDS"
garder() { grep -v "^$1=" "$IDS" > "$IDS.tmp"; echo "$1=$2" >> "$IDS.tmp"; mv "$IDS.tmp" "$IDS"; }
lire() { stellar contract invoke --id "$1" --source-account "$ADMIN" $N --send=no -- "${@:2}" 2>/dev/null | tail -1 | tr -d '"'; }
pk() { stellar keys public-key "$1"; }
dollars() { awk -v u="$1" 'BEGIN{printf "%.2f", u/10000000}'; }

ETAPE="${1:-}"
G=$(pk "$ADMIN") || { echo "Clé admin '$ADMIN' introuvable (stellar keys ls)"; exit 1; }
BOURSE=$(pk stg3-bourse 2>/dev/null) ; CONTINU=$(pk stg3-continu 2>/dev/null)

# ---------- état ----------
FOURNI=$(lire $POOL_V2 fourni --preteur "$ADMIN")
MARCHE=$(lire $POOL_V2 marche)
CAISSE=$(printf '%s' "$MARCHE" | grep -oE 'caisse:[0-9]+|"?caisse"?:"?[0-9]+' | grep -oE '[0-9]+$')
EMPRUNTE=$(printf '%s' "$MARCHE" | grep -oE 'total_emprunte"?:"?[0-9]+' | grep -oE '[0-9]+$')
A_DEPLACER=$(( ${FOURNI:-0} < ${CAISSE:-0} ? ${FOURNI:-0} : ${CAISSE:-0} ))
PRIX=$(node -e "fetch('https://api.hyperliquid.xyz/info',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'metaAndAssetCtxs',dex:'xyz'})}).then(r=>r.json()).then(([m,c])=>{const i=m.universe.findIndex(a=>a.name==='xyz:AAPL');console.log(Math.round(Number(c[i].oraclePx)*1e7))}).catch(()=>console.log(''))")

if [ -z "$ETAPE" ]; then
  echo "== État actuel (lecture seule)"
  echo "Admin ($ADMIN)            : $G"
  echo "Pool v2                   : $POOL_V2"
  echo "  caisse (libre)          : $(dollars ${CAISSE:-0}) USDC"
  echo "  total emprunté          : $(dollars ${EMPRUNTE:-0}) USDC"
  echo "  fourni par $ADMIN        : $(dollars ${FOURNI:-0}) USDC"
  echo "  -> déplaçable maintenant: $(dollars $A_DEPLACER) USDC"
  echo "Prix Apple (Hyperliquid)  : $(dollars ${PRIX:-0}) \$"
  echo "Rapporteurs (robots)      : bourse=$BOURSE continu=$CONTINU"
  echo "Déjà fait (migration-v3.ids) :"; sed 's/^/  /' "$IDS"
  cat <<PLAN

== Étapes (une transaction chacune, signée par $ADMIN)
 M1  Déployer l'adaptateur de prix (prix de départ = Hyperliquid, mêmes 2 robots)
 M2  Déployer le prêt v3 (mêmes jetons tAAPL / USDC, plafonds 50 USDC et 20 %, démo perso active)
 M3  Brancher le prêt v3 sur l'adaptateur (fixer_oracle)
 M4  Le robinet autorise le prêt v3 à détenir des tAAPL (autoriser)
 M5  Retirer $(dollars $A_DEPLACER) USDC du pool v2 vers le compte $ADMIN (retirer_fonds)
 M6  Fournir ces USDC au prêt v3 (fournir)
Ensuite, hors script : ORACLE_ID dans GitHub, puis le site sur le prêt v3 (« en ligne »).
PLAN
  exit 0
fi

confirmer() { echo; echo ">>> $ETAPE : $1"; read -r -p "Envoyer cette transaction ? (oui/non) " r; [ "$r" = oui ] || { echo "Annulé, rien n'est envoyé."; exit 0; }; }
REG="{\"tolerance_bps\":\"100\",\"fenetre_s\":600,\"saut_max_bps\":\"1500\",\"ecart_hors_seance_bps\":\"1000\",\"silence_bourse_s\":1800,\"intervalle_min_s\":300,\"bande_min\":\"$((1*U))\",\"bande_max\":\"$((10000*U))\"}"

case "$ETAPE" in
  M1)
    [ -n "${ORACLE:-}" ] && { echo "Déjà fait : ORACLE=$ORACLE"; exit 0; }
    [ -n "$PRIX" ] && [ -n "$BOURSE" ] && [ -n "$CONTINU" ] || { echo "Prix Hyperliquid ou clés stg3-* introuvables"; exit 1; }
    confirmer "déployer l'adaptateur, prix de départ $(dollars $PRIX) \$, admin $ADMIN"
    ID=$(stellar contract deploy --wasm $W/oracle_prix.wasm --source-account "$ADMIN" $N --alias oracle-prix-prod -- --admin "$ADMIN" --rapporteur_bourse "$BOURSE" --rapporteur_continu "$CONTINU" --actif AAPL --prix_initial "$PRIX" --reglages "$REG" | tail -1)
    [ -n "$ID" ] && garder ORACLE "$ID" && echo "ORACLE = $ID";;
  M2)
    [ -n "${PRET:-}" ] && { echo "Déjà fait : PRET=$PRET"; exit 0; }
    confirmer "déployer le prêt v3 (tAAPL / USDC, plafonds 50 USDC et 20 %), admin $ADMIN"
    ID=$(stellar contract deploy --wasm $W/pret.wasm --source-account "$ADMIN" $N --alias pret-v3-prod -- --admin "$ADMIN" --jeton_garantie $TAAPL --jeton_pret $USDC --prix "${PRIX:-$((356*U))}" --plafond_fixe $((50*U)) --plafond_caisse_bps 2000 --demo_perso true | tail -1)
    [ -n "$ID" ] && garder PRET "$ID" && echo "PRET = $ID";;
  M3)
    [ -n "${ORACLE:-}" ] && [ -n "${PRET:-}" ] || { echo "Faire M1 et M2 d'abord"; exit 1; }
    confirmer "brancher le prêt $PRET sur l'adaptateur $ORACLE"
    stellar contract invoke --id "$PRET" --source-account "$ADMIN" $N -- fixer_oracle --oracle "[\"$ORACLE\",{\"Other\":\"AAPL\"}]" && echo "prix vu par le prêt : $(lire $PRET marche | grep -oE 'prix"?:"?[0-9]+' | head -1)";;
  M4)
    [ -n "${PRET:-}" ] || { echo "Faire M2 d'abord"; exit 1; }
    confirmer "le robinet $ROBINET autorise le prêt $PRET à détenir des tAAPL"
    stellar contract invoke --id $ROBINET --source-account "$ADMIN" $N -- autoriser --qui "$PRET";;
  M5)
    [ "$A_DEPLACER" -gt 0 ] || { echo "Rien à retirer du pool v2"; exit 0; }
    confirmer "retirer $(dollars $A_DEPLACER) USDC du pool v2 vers $ADMIN"
    stellar contract invoke --id $POOL_V2 --source-account "$ADMIN" $N -- retirer_fonds --preteur "$ADMIN" --montant "$A_DEPLACER" && garder RETIRE "$A_DEPLACER";;
  M6)
    [ -n "${PRET:-}" ] && [ -n "${RETIRE:-}" ] || { echo "Faire M2 et M5 d'abord"; exit 1; }
    confirmer "fournir $(dollars $RETIRE) USDC au prêt v3 $PRET"
    stellar contract invoke --id "$PRET" --source-account "$ADMIN" $N -- fournir --preteur "$ADMIN" --montant "$RETIRE" && echo "marché v3 : $(lire $PRET marche)";;
  *) echo "Étape inconnue : M1 à M6"; exit 1;;
esac
