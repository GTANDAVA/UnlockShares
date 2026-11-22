#!/usr/bin/env bash
# Déménagement vers le hub v2, sur Stellar TESTNET (voir /mnt/project-files/unlockshares-v2/plan-hub-v2.md).
# SANS argument : LECTURE SEULE. Affiche le plan et ce qui est déjà fait. N'envoie rien.
# AVEC une étape : exécute CETTE étape seulement, après confirmation « oui ».
#   bash scripts/migration-hub-v2.sh             # plan + état
#   bash scripts/migration-hub-v2.sh M2 NVDA     # une seule transaction
# On GARDE les 12 jetons, les 12 oracles, le robinet et les robots (adresses dans deploiement-hub.ids).
# Le site en ligne continue sur l'ancien hub tant que les variables Vercel ne sont pas changées (M7).
set -uo pipefail
N="--network testnet"
MARGE="--instruction-leeway 500000"
W=target/wasm32v1-none/release
U=10000000
ADMIN="${ADMIN:-greg}"
USDC=CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
TITRES="AAPL AMZN NVDA CRCL INTC SPCX ANT AMD COIN IBM NOK BB"
IDS=deploiement-hub.ids
[ -f "$IDS" ] || { echo "$IDS introuvable : lance ce script dans le dossier où le hub a été déployé."; exit 1; }
source "$IDS"
garder() { grep -v "^$1=" "$IDS" > "$IDS.tmp"; echo "$1=$2" >> "$IDS.tmp"; mv "$IDS.tmp" "$IDS"; }
val() { local v="$1"; printf '%s' "${!v:-}"; }
pk() { stellar keys public-key "$1" 2>/dev/null; }
dollars() { awk -v u="$1" 'BEGIN{printf "%.2f", u/10000000}'; }
lire() { stellar contract invoke --id "$1" --source-account "$ADMIN" $N --send=no -- "${@:2}" 2>/dev/null; }

ETAPE="${1:-}"; T="${2:-}"
G=$(pk "$ADMIN") || true
[ -n "$G" ] || { echo "Clé admin '$ADMIN' introuvable (stellar keys ls)"; exit 1; }
[ -n "${HUB:-}" ] || { echo "Ancien hub (HUB) absent de $IDS"; exit 1; }

if [ -z "$ETAPE" ]; then
  echo "== Lecture seule : rien n'est envoyé"
  echo "Admin ($ADMIN) : $G"
  echo "Ancien hub     : $HUB"
  echo "Hub v2         : ${HUB_V2:-pas encore déployé}"
  echo "Ta part dans l'ancien hub : $(lire "$HUB" fourni --preteur "$G" || echo '?') (unités, 7 décimales)"
  echo "Déjà fait :"; grep -E '^(HUB_V2|V2_|PAUSE_|M4|M6|MAJ)' "$IDS" | sed 's/^/  /'
  cat <<PLAN

== Étapes : une transaction chacune (sauf M1 : envoi du code + déploiement), après « oui »
 M1          Envoyer le code du hub v2 et le déployer (mêmes plafonds : 50 USDC par adresse, 20 % de la caisse)
 M2 <TITRE>  Ajouter l'action au hub v2, avec ses règles actuelles et son prix du moment (12 fois)
 M3 <TITRE>  Brancher l'oracle existant de l'action sur le hub v2 (12 fois)
 M4          Le robinet autorise le hub v2 à détenir les actions
 M5 <TITRE>  Ancien hub : mettre l'action en pause (plus de nouveaux emprunts, rembourser reste permis) (12 fois)
 M6 <MONTANT> Déplacer ta caisse : retirer MONTANT USDC de l'ancien hub, puis les fournir au hub v2 (2 transactions)
 M8          Test de la mise à jour du code : le hub v2 se remet à jour avec son propre code (rien ne change)
 M7 (hors blockchain) Vercel : VITE_HUB_ID=<hub v2>, VITE_HUB_VERSION=2, HUB_V2_ID=<hub v2> ; GitHub : variable HUB_V2_ID
Titres : $TITRES
PLAN
  exit 0
fi

confirmer() { echo; echo ">>> $ETAPE ${T} : $1"; read -r -p "Envoyer ? (oui/non) " r; [ "$r" = oui ] || { echo "Annulé, rien n'est envoyé."; exit 0; }; }
besoin_titre() { [[ " $TITRES " == *" $T "* ]] || { echo "Donne un titre : $TITRES"; exit 1; }; }
besoin_v2() { [ -n "${HUB_V2:-}" ] || { echo "Faire M1 d'abord"; exit 1; }; }

case "$ETAPE" in
  M1)
    [ -n "${HUB_V2:-}" ] && { echo "Déjà fait : HUB_V2=$HUB_V2"; exit 0; }
    [ -f "$W/hub.wasm" ] || { echo "Lance d'abord : stellar contract build"; exit 1; }
    confirmer "envoyer le code et déployer le hub v2 (admin $ADMIN, prête $USDC)"
    ID=$(stellar contract deploy --wasm $W/hub.wasm --source-account "$ADMIN" $N --alias hub-v2 -- --admin "$ADMIN" --jeton_pret $USDC --plafond_fixe $((50*U)) --plafond_caisse_bps 2000 --demo_perso true | tail -1)
    [ -n "$ID" ] && garder HUB_V2 "$ID" && echo "HUB_V2 = $ID";;
  M2)
    besoin_titre; besoin_v2; S=$(val SAC_$T); [ -n "$S" ] || { echo "SAC_$T absent de $IDS"; exit 1; }
    [ -n "$(val V2_SPOKE_$T)" ] && { echo "Déjà fait"; exit 0; }
    R=$(lire "$HUB" spoke --jeton "$S" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const s=JSON.parse(d);console.log(JSON.stringify(s.regles))})")
    P=$(lire "$HUB" spoke --jeton "$S" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).prix))")
    [ -n "$R" ] && [ -n "$P" ] || { echo "Lecture de l'ancien spoke $T impossible, réessaie"; exit 1; }
    confirmer "ajouter $T au hub v2, règles $R, prix $(dollars $P) \$"
    stellar contract invoke --id "$HUB_V2" --source-account "$ADMIN" $N $MARGE -- ajouter_spoke --jeton "$S" --regles "$R" --prix "$P" && garder "V2_SPOKE_$T" ok;;
  M3)
    besoin_titre; besoin_v2; S=$(val SAC_$T); O=$(val ORACLE_$T); [ -n "$O" ] && [ -n "$(val V2_SPOKE_$T)" ] || { echo "Faire M2 $T d'abord (ou ORACLE_$T absent)"; exit 1; }
    confirmer "le hub v2 lit le prix de $T chez l'oracle $O"
    stellar contract invoke --id "$HUB_V2" --source-account "$ADMIN" $N $MARGE -- fixer_oracle --jeton "$S" --oracle "[\"$O\",{\"Other\":\"$T\"}]" && garder "V2_ORACLE_$T" ok;;
  M4)
    besoin_v2; [ -n "${ROBINET:-}" ] || { echo "ROBINET absent de $IDS"; exit 1; }
    confirmer "le robinet autorise le hub v2 $HUB_V2 à détenir toutes ses actions"
    stellar contract invoke --id "$ROBINET" --source-account "$ADMIN" $N -- autoriser --qui "$HUB_V2" && garder M4 ok;;
  M5)
    besoin_titre; S=$(val SAC_$T)
    confirmer "ancien hub : $T en pause (les emprunteurs peuvent toujours rembourser et récupérer leurs actions)"
    stellar contract invoke --id "$HUB" --source-account "$ADMIN" $N $MARGE -- ouvrir_spoke --jeton "$S" --actif false && garder "PAUSE_$T" ok;;
  M6)
    besoin_v2; M="${T:-}"; [[ "$M" =~ ^[0-9]+$ ]] || { echo "Donne un montant entier en USDC, ex. : M6 170"; exit 1; }
    confirmer "retirer $M USDC de l'ancien hub vers $G"
    stellar contract invoke --id "$HUB" --source-account "$ADMIN" $N $MARGE -- retirer_fonds --preteur "$G" --montant $((M*U)) || exit 1
    confirmer "fournir $M USDC au hub v2"
    stellar contract invoke --id "$HUB_V2" --source-account "$ADMIN" $N $MARGE -- fournir --preteur "$G" --montant $((M*U)) && garder M6 "$M";;
  M8)
    besoin_v2
    H=$(stellar contract fetch --id "$HUB_V2" $N -o /tmp/hub-v2-en-ligne.wasm >/dev/null && sha256sum /tmp/hub-v2-en-ligne.wasm | cut -d' ' -f1)
    [ -n "$H" ] || { echo "Lecture du code du hub v2 impossible"; exit 1; }
    confirmer "test : le hub v2 se met à jour avec son propre code ($H), rien ne doit changer"
    stellar contract invoke --id "$HUB_V2" --source-account "$ADMIN" $N -- mettre_a_jour --code "$H" && garder MAJ ok;;
  *) echo "Étape inconnue : M1 à M6, M8 (lance le script sans argument pour voir le plan)"; exit 1;;
esac
