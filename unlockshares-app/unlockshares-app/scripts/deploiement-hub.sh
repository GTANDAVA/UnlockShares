#!/usr/bin/env bash
# Étape 5 du plan hub & spokes : déploiement sur Stellar TESTNET (rien en production, aucun fonds réel).
# SANS argument : LECTURE SEULE. Affiche le plan, les prix du moment et ce qui est déjà fait. N'envoie rien.
# AVEC une étape : exécute CETTE transaction seulement, après confirmation « oui ».
#   bash scripts/deploiement-hub.sh              # plan + état
#   bash scripts/deploiement-hub.sh H3 NVDA      # une seule transaction (ici : le jeton de test Nvidia)
# Le site en ligne et le prêt v3 ne sont PAS touchés : le hub a ses propres jetons de test (même code, nouvel émetteur).
# Les adresses créées sont gardées dans deploiement-hub.ids (adresses publiques, aucun secret).
set -uo pipefail
N="--network testnet"
W=target/wasm32v1-none/release
U=10000000
ADMIN="${ADMIN:-greg}"
EMETTEUR="${EMETTEUR:-emetteur-actions}"
USDC=CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA     # jeton prêté (le même que le prêt v3)
ORACLE_AAPL=CCA3MJ2G6JOYE3BY5QRHSXZ4B5WQ232OF7WV3JLNVRJ5CB6QEP7P4OMI # oracle Apple déjà en service, réutilisé
TITRES="AAPL AMZN NVDA CRCL INTC SPCX ANT AMD COIN IBM NOK BB"
IDS=deploiement-hub.ids
touch "$IDS"; source "$IDS"
garder() { grep -v "^$1=" "$IDS" > "$IDS.tmp"; echo "$1=$2" >> "$IDS.tmp"; mv "$IDS.tmp" "$IDS"; }
val() { local v="$1"; printf '%s' "${!v:-}"; }
pk() { stellar keys public-key "$1" 2>/dev/null; }
dollars() { awk -v u="$1" 'BEGIN{printf "%.2f", u/10000000}'; }

# Règles de chaque spoke : ratio max, seuil, bonus, cible, prime, plafond (points de base), montant du robinet (actions)
regles() {
  case "$1" in
    AAPL) echo "5000 8000 500 6000 50 2500";;
    AMZN) echo "5000 8000 500 6000 50 2000";;
    IBM)  echo "5000 8000 500 6000 50 1500";;
    NVDA) echo "4500 8000 500 6000 100 2000";;
    AMD)  echo "4500 8000 500 6000 100 1500";;
    INTC) echo "4500 8000 500 6000 100 1500";;
    NOK)  echo "4500 8000 500 6000 100 1000";;
    BB)   echo "4000 8000 500 6000 200 1000";;
    COIN) echo "3500 8000 500 6000 250 1000";;
    CRCL) echo "3500 8000 500 6000 250 1000";;
    SPCX) echo "3500 8000 500 6000 300 1000";;
    ANT)  echo "3500 8000 500 6000 300 1000";;
  esac
}
regles_json() {
  read -r l s b c p pl <<< "$(regles "$1")"
  echo "{\"ltv_max_bps\":\"$l\",\"seuil_bps\":\"$s\",\"bonus_bps\":\"$b\",\"cible_bps\":\"$c\",\"prime_bps\":\"$p\",\"plafond_bps\":\"$pl\"}"
}
# Prix du moment (unités à 7 décimales) : Hyperliquid, sinon Yahoo.
prix() {
  node -e "
const t='$1'
const hl=()=>fetch('https://api.hyperliquid.xyz/info',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'metaAndAssetCtxs',dex:'xyz'})}).then(r=>r.json()).then(([m,c])=>{const i=m.universe.findIndex(a=>a.name==='xyz:'+t);if(i<0)throw 0;return Number(c[i].oraclePx)})
const yh=()=>fetch('https://query1.finance.yahoo.com/v8/finance/chart/'+t,{headers:{'user-agent':'Mozilla/5.0'}}).then(r=>r.json()).then(j=>j.chart.result[0].meta.regularMarketPrice)
;hl().catch(yh).then(p=>console.log(Math.round(p*1e7))).catch(()=>console.log(''))"
}

ETAPE="${1:-}"; T="${2:-}"
G=$(pk "$ADMIN") || true
[ -n "$G" ] || { echo "Clé admin '$ADMIN' introuvable (stellar keys ls)"; exit 1; }
E=$(pk "$EMETTEUR")
BOURSE=$(pk stg3-bourse); CONTINU=$(pk stg3-continu)

if [ -z "$ETAPE" ]; then
  echo "== Lecture seule : rien n'est envoyé"
  echo "Admin ($ADMIN)                 : $G"
  echo "Émetteur des jetons de test    : ${E:-pas encore créé ($EMETTEUR)}"
  echo "Robots (rapporteurs)           : bourse=${BOURSE:-?} continu=${CONTINU:-?}"
  echo "Prix du moment :"
  for t in $TITRES; do p=$(prix $t); echo "  $t : $( [ -n "$p" ] && dollars $p || echo '?') \$   règles (bps) : $(regles $t)"; done
  echo "Déjà fait ($IDS) :"; sed 's/^/  /' "$IDS"
  cat <<PLAN

== Étapes : UNE transaction chacune, signée par la clé indiquée, après « oui »
 H1          Créer le compte émetteur des jetons de test ($EMETTEUR, Friendbot)
 H2          Émetteur : jetons « autorisation requise » (comme de vraies actions)          [$EMETTEUR]
 H3 <TITRE>  Créer le jeton de test T<TITRE> et son contrat SAC   (12 fois)                  [$ADMIN]
 H4          Déployer le robinet multi-actions (1 passage par heure et par adresse)       [$ADMIN]
 H5 <TITRE>  Donner l'admin du jeton au robinet (il crée et autorise les jetons) (12 fois)   [$EMETTEUR]
 H6 <TITRE>  Déployer l'oracle de prix de l'action, mêmes 2 robots (11 fois, Apple réutilisé) [$ADMIN]
 H7          Déployer le hub (USDC, 50 USDC max par adresse, 20 % de la caisse, démo perso) [$ADMIN]
 H8 <TITRE>  Ajouter l'action au hub avec ses règles et son prix (12 fois)                  [$ADMIN]
 H9 <TITRE>  Brancher l'oracle de l'action sur le hub (12 fois)                             [$ADMIN]
 H10 <TITRE> Le robinet distribue 2 actions de ce jeton (12 fois)                           [$ADMIN]
 H11         Le robinet autorise le hub à détenir toutes les actions                       [$ADMIN]
Titres : $TITRES
Ensuite, hors script et avec ton accord : variables GitHub ORACLE_ID_<TITRE>, remplir la caisse (étape 6), site (étape 7).
Rien ici ne touche le prêt v3, le robinet v2 ni le site en ligne.
PLAN
  exit 0
fi

confirmer() { echo; echo ">>> $ETAPE ${T} : $1"; read -r -p "Envoyer cette transaction ? (oui/non) " r; [ "$r" = oui ] || { echo "Annulé, rien n'est envoyé."; exit 0; }; }
besoin_titre() { [[ " $TITRES " == *" $T "* ]] || { echo "Donne un titre : $TITRES"; exit 1; }; }
REG="{\"tolerance_bps\":\"100\",\"fenetre_s\":600,\"saut_max_bps\":\"1500\",\"ecart_hors_seance_bps\":\"1000\",\"silence_bourse_s\":1800,\"intervalle_min_s\":300,\"bande_min\":\"$((1*U))\",\"bande_max\":\"$((10000*U))\"}"

case "$ETAPE" in
  H1)
    [ -n "$E" ] && { echo "Déjà fait : $EMETTEUR = $E"; exit 0; }
    confirmer "créer le compte $EMETTEUR sur testnet (Friendbot, XLM de test)"
    stellar keys generate "$EMETTEUR" $N --fund && echo "$EMETTEUR = $(pk "$EMETTEUR")";;
  H2)
    [ -n "$E" ] || { echo "Faire H1 d'abord"; exit 1; }
    confirmer "le compte $E exige une autorisation pour détenir ses jetons (révocable, clawback)"
    stellar tx new set-options --source-account "$EMETTEUR" $N --set-required --set-revocable --set-clawback-enabled && garder FLAGS ok;;
  H3)
    besoin_titre; [ -n "${FLAGS:-}" ] || { echo "Faire H2 d'abord"; exit 1; }
    [ -n "$(val SAC_$T)" ] && { echo "Déjà fait : SAC_$T=$(val SAC_$T)"; exit 0; }
    confirmer "créer le contrat du jeton T$T:$E"
    ID=$(stellar contract asset deploy --asset "T$T:$E" --source-account "$ADMIN" $N | tail -1)
    [ -n "$ID" ] && garder "SAC_$T" "$ID" && echo "SAC_$T = $ID";;
  H4)
    [ -n "${ROBINET:-}" ] && { echo "Déjà fait : ROBINET=$ROBINET"; exit 0; }
    confirmer "déployer le robinet multi-actions, admin $ADMIN, 1 passage par heure"
    ID=$(stellar contract deploy --wasm $W/robinet_actions.wasm --source-account "$ADMIN" $N --alias robinet-actions -- --admin "$ADMIN" --delai 3600 | tail -1)
    [ -n "$ID" ] && garder ROBINET "$ID" && echo "ROBINET = $ID";;
  H5)
    besoin_titre; S=$(val SAC_$T); [ -n "$S" ] && [ -n "${ROBINET:-}" ] || { echo "Faire H3 $T et H4 d'abord"; exit 1; }
    confirmer "le robinet $ROBINET devient admin du jeton T$T ($S)"
    stellar contract invoke --id "$S" --source-account "$EMETTEUR" $N -- set_admin --new_admin "$ROBINET" && garder "ADMIN_$T" ok;;
  H6)
    besoin_titre
    [ "$T" = AAPL ] && { echo "Apple réutilise l'oracle en service : $ORACLE_AAPL"; garder ORACLE_AAPL "$ORACLE_AAPL"; exit 0; }
    [ -n "$(val ORACLE_$T)" ] && { echo "Déjà fait : ORACLE_$T=$(val ORACLE_$T)"; exit 0; }
    [ -n "$BOURSE" ] && [ -n "$CONTINU" ] || { echo "Clés des robots stg3-bourse / stg3-continu introuvables"; exit 1; }
    P=$(prix $T); [ -n "$P" ] || { echo "Prix de $T introuvable, réessaie"; exit 1; }
    confirmer "déployer l'oracle $T, prix de départ $(dollars $P) \$, robots $BOURSE / $CONTINU"
    ID=$(stellar contract deploy --wasm $W/oracle_prix.wasm --source-account "$ADMIN" $N --alias "oracle-$(echo $T | tr A-Z a-z)" -- --admin "$ADMIN" --rapporteur_bourse "$BOURSE" --rapporteur_continu "$CONTINU" --actif "$T" --prix_initial "$P" --reglages "$REG" | tail -1)
    [ -n "$ID" ] && garder "ORACLE_$T" "$ID" && echo "ORACLE_$T = $ID";;
  H7)
    [ -n "${HUB:-}" ] && { echo "Déjà fait : HUB=$HUB"; exit 0; }
    confirmer "déployer le hub (prête $USDC ; 50 USDC max par adresse ; 20 % de la caisse par emprunt ; démo perso active)"
    ID=$(stellar contract deploy --wasm $W/hub.wasm --source-account "$ADMIN" $N --alias hub -- --admin "$ADMIN" --jeton_pret $USDC --plafond_fixe $((50*U)) --plafond_caisse_bps 2000 --demo_perso true | tail -1)
    [ -n "$ID" ] && garder HUB "$ID" && echo "HUB = $ID";;
  H8)
    besoin_titre; S=$(val SAC_$T); [ -n "$S" ] && [ -n "${HUB:-}" ] || { echo "Faire H3 $T et H7 d'abord"; exit 1; }
    P=$(prix $T); [ -n "$P" ] || { echo "Prix de $T introuvable, réessaie"; exit 1; }
    confirmer "ajouter $T au hub, règles $(regles $T), prix $(dollars $P) \$"
    stellar contract invoke --id "$HUB" --source-account "$ADMIN" $N -- ajouter_spoke --jeton "$S" --regles "$(regles_json $T)" --prix "$P" && garder "SPOKE_$T" ok;;
  H9)
    besoin_titre; S=$(val SAC_$T); O=$(val ORACLE_$T); [ -n "$S" ] && [ -n "$O" ] && [ -n "$(val SPOKE_$T)" ] || { echo "Faire H6 $T et H8 $T d'abord"; exit 1; }
    confirmer "le hub lit le prix de $T chez l'oracle $O"
    stellar contract invoke --id "$HUB" --source-account "$ADMIN" $N -- fixer_oracle --jeton "$S" --oracle "[\"$O\",{\"Other\":\"$T\"}]" && garder "BRANCHE_$T" ok;;
  H10)
    besoin_titre; S=$(val SAC_$T); [ -n "$S" ] && [ -n "$(val ADMIN_$T)" ] || { echo "Faire H5 $T d'abord"; exit 1; }
    confirmer "le robinet donne 2 T$T par passage"
    stellar contract invoke --id "$ROBINET" --source-account "$ADMIN" $N -- fixer_jeton --jeton "$S" --montant $((2*U)) && garder "ROBINET_$T" ok;;
  H11)
    [ -n "${ROBINET:-}" ] && [ -n "${HUB:-}" ] || { echo "Faire H4 et H7 d'abord"; exit 1; }
    confirmer "le robinet autorise le hub $HUB à détenir toutes ses actions"
    stellar contract invoke --id "$ROBINET" --source-account "$ADMIN" $N -- autoriser --qui "$HUB" && garder AUTORISE ok;;
  *) echo "Étape inconnue : H1 à H11 (lance le script sans argument pour voir le plan)"; exit 1;;
esac
