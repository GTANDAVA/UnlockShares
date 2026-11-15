#!/usr/bin/env bash
# Redéploiement COMPLET d'UnlockShares sur Stellar testnet (par ex. après une réinitialisation du testnet).
#
# Analogie : reconstruire le petit marché après un incendie. On réimprime l'action de jeu (tAAPL),
# on réinstalle le robinet, le guichet de prêt et le distributeur, puis on prépare la vitrine (.env.production).
#
# PAR DÉFAUT : SIMULATION. Le script affiche chaque commande sans rien envoyer.
# Pour exécuter pour de vrai :    bash scripts/redeploy-testnet.sh --executer
#
# Réglages (variables d'environnement facultatives) :
#   ADMIN=greg              clé locale admin des contrats (doit exister : stellar keys ls)
#   EMETTEUR_AAPL=emetteur-aapl   clé locale de l'émetteur de tAAPL (créée et financée si absente)
#   PRET_CODE=USDC  PRET_EMETTEUR=GBBD47…  jeton prêté (par défaut : USDC de Circle testnet, compatible MoneyGram)
#   PRIX=100  PLAFOND=50  PLAFOND_CAISSE_BPS=2000  ROBINET_ACTIONS=2  DISTRIB_USDC=20
#
# Ce qui reste MANUEL (le script le rappelle à la fin) :
#   - remplir la caisse et le distributeur en USDC (l'USDC de Circle ne s'imprime pas) : scripts/recharger-usdc.mjs du frontend ;
#   - relire puis copier frontend/.env.production.new vers .env.production, commit, fusion → Vercel redéploie.
#
# Usage : depuis unlockshares-app/unlockshares-app, dans Git Bash (ou PowerShell : & "C:\Program Files\Git\bin\bash.exe" scripts/redeploy-testnet.sh).
set -uo pipefail

EXECUTER=0
[ "${1:-}" = "--executer" ] && EXECUTER=1

N="--network testnet"
U=10000000
ADMIN="${ADMIN:-greg}"
EMETTEUR_AAPL="${EMETTEUR_AAPL:-emetteur-aapl}"
PRET_CODE="${PRET_CODE:-USDC}"
PRET_EMETTEUR="${PRET_EMETTEUR:-GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5}"
PRIX="${PRIX:-100}"
PLAFOND="${PLAFOND:-50}"
PLAFOND_CAISSE_BPS="${PLAFOND_CAISSE_BPS:-2000}"
ROBINET_ACTIONS="${ROBINET_ACTIONS:-2}"
DISTRIB_USDC="${DISTRIB_USDC:-20}"
W=target/wasm32v1-none/release
FRONT=../../unlockshares-frontend-testnet/frontend
ALIAS_SUFFIXE="redeploy-$(date +%Y%m%d)"

etape() { printf '\n== %s\n' "$*"; }
stop() { printf '\nARRÊT : %s\n' "$*" >&2; exit 1; }

# Exécute (ou affiche en simulation) une commande ; renvoie sa dernière ligne de sortie.
faire() {
  if [ $EXECUTER -eq 0 ]; then
    printf '  [simulation] %s\n' "$*" >&2
    return 0
  fi
  local out
  out=$("$@" 2>&1) || { printf '%s\n' "$out" >&2; stop "échec de : $*"; }
  printf '%s\n' "$out" | tail -1
}

# Adresse d'un contrat par alias, ou valeur fictive lisible en simulation.
adresse() {
  if [ $EXECUTER -eq 0 ]; then printf 'C_%s_EN_SIMULATION' "$1"; return; fi
  stellar contract alias show "$1" $N 2>/dev/null
}

etape "0. Vérifications"
command -v stellar >/dev/null || stop "Stellar CLI introuvable."
stellar keys public-key "$ADMIN" >/dev/null 2>&1 || stop "Clé admin '$ADMIN' introuvable (stellar keys ls)."
ADMIN_G=$(stellar keys public-key "$ADMIN")
echo "Admin            : $ADMIN ($ADMIN_G)"
echo "Jeton prêté      : $PRET_CODE:$PRET_EMETTEUR"
echo "Réglages         : prix $PRIX, plafond $PLAFOND par adresse, $((PLAFOND_CAISSE_BPS / 100)) % de la caisse, robinet $ROBINET_ACTIONS tAAPL/h, distributeur $DISTRIB_USDC/jour"
[ $EXECUTER -eq 1 ] && echo "MODE : EXÉCUTION (transactions réelles sur testnet)" || echo "MODE : SIMULATION (rien n'est envoyé ; ajoute --executer pour de vrai)"
curl -s -o /dev/null -w '%{http_code}' https://horizon-testnet.stellar.org/accounts/"$ADMIN_G" | grep -q 200 \
  || { echo "Le compte admin n'existe pas (testnet réinitialisé ?) : il sera financé par Friendbot."; faire stellar keys fund "$ADMIN" $N >/dev/null; }

etape "1. Compiler les contrats (wasm)"
faire stellar contract build >/dev/null
for c in pret robinet distributeur; do [ $EXECUTER -eq 0 ] || [ -f "$W/$c.wasm" ] || stop "$W/$c.wasm absent"; done
[ $EXECUTER -eq 1 ] && sha256sum $W/pret.wasm $W/robinet.wasm $W/distributeur.wasm

etape "2. Émetteur de tAAPL (action sous contrôle : autorisation requise, gel et reprise possibles)"
if ! stellar keys public-key "$EMETTEUR_AAPL" >/dev/null 2>&1; then
  faire stellar keys generate "$EMETTEUR_AAPL" $N --fund >/dev/null
elif [ "$(curl -s -o /dev/null -w '%{http_code}' https://horizon-testnet.stellar.org/accounts/$(stellar keys public-key "$EMETTEUR_AAPL"))" != 200 ]; then
  faire stellar keys fund "$EMETTEUR_AAPL" $N >/dev/null
fi
EA=$(stellar keys public-key "$EMETTEUR_AAPL" 2>/dev/null || echo G_EMETTEUR_AAPL_EN_SIMULATION)
faire stellar tx new set-options --source-account "$EMETTEUR_AAPL" $N --set-required --set-revocable --set-clawback-enabled >/dev/null
echo "Émetteur tAAPL : $EA"

etape "3. Jetons dans le monde des contrats (SAC)"
# Adresse déterministe d'un SAC (aucune transaction), puis déploiement seulement s'il n'existe pas encore.
sac() {
  local actif="$1" id
  id=$(stellar contract id asset --asset "$actif" $N 2>/dev/null | tail -1)
  if [ $EXECUTER -eq 1 ] && ! stellar contract invoke --id "$id" --source-account "$ADMIN" $N --send=no -- name >/dev/null 2>&1; then
    faire stellar contract asset deploy --asset "$actif" --source-account "$ADMIN" $N >/dev/null
  elif [ $EXECUTER -eq 0 ]; then
    printf '  [simulation] stellar contract asset deploy --asset %s (si absent)\n' "$actif" >&2
  fi
  printf '%s' "$id"
}
TAAPL=$(sac "TAAPL:$EA")
PRET_JETON=$(sac "$PRET_CODE:$PRET_EMETTEUR")
echo "tAAPL (SAC)       : $TAAPL"
echo "$PRET_CODE (SAC)  : $PRET_JETON"

etape "4. Robinet : $ROBINET_ACTIONS tAAPL par heure, pas de dollar"
faire stellar contract deploy --wasm $W/robinet.wasm --source-account "$ADMIN" $N --alias "robinet-$ALIAS_SUFFIXE" -- \
  --admin "$ADMIN" --action "$TAAPL" --dollar "$PRET_JETON" --montant_action $((ROBINET_ACTIONS * U)) --montant_dollar 0 --delai 3600 >/dev/null
ROBINET=$(adresse "robinet-$ALIAS_SUFFIXE")
# Le robinet devient admin de tAAPL : il pourra autoriser et distribuer l'action.
faire stellar contract invoke --id "$TAAPL" --source-account "$EMETTEUR_AAPL" $N -- set_admin --new_admin "$ROBINET" >/dev/null
echo "Robinet : $ROBINET"

etape "5. Guichet de prêt (v2) : prix $PRIX, plafond $PLAFOND, démo perso active"
faire stellar contract deploy --wasm $W/pret.wasm --source-account "$ADMIN" $N --alias "pret-$ALIAS_SUFFIXE" -- \
  --admin "$ADMIN" --jeton_garantie "$TAAPL" --jeton_pret "$PRET_JETON" --prix $((PRIX * U)) \
  --plafond_fixe $((PLAFOND * U)) --plafond_caisse_bps "$PLAFOND_CAISSE_BPS" --demo_perso true >/dev/null
PRET=$(adresse "pret-$ALIAS_SUFFIXE")
# Le pool doit pouvoir détenir des tAAPL (jeton à autorisation).
faire stellar contract invoke --id "$ROBINET" --source-account "$ADMIN" $N -- autoriser --qui "$PRET" >/dev/null
echo "Pool : $PRET"

etape "6. Distributeur : $DISTRIB_USDC $PRET_CODE par adresse et par jour (réserve à remplir à la main)"
faire stellar contract deploy --wasm $W/distributeur.wasm --source-account "$ADMIN" $N --alias "distributeur-$ALIAS_SUFFIXE" -- \
  --admin "$ADMIN" --jeton "$PRET_JETON" --montant $((DISTRIB_USDC * U)) --delai 86400 >/dev/null
DISTRIB=$(adresse "distributeur-$ALIAS_SUFFIXE")
echo "Distributeur : $DISTRIB"

etape "7. Contrôles (lecture seule)"
if [ $EXECUTER -eq 1 ]; then
  echo "marche() : $(stellar contract invoke --id "$PRET" --source-account "$ADMIN" $N --send=no -- marche 2>/dev/null | tail -1)"
  echo "jetons() : $(stellar contract invoke --id "$PRET" --source-account "$ADMIN" $N --send=no -- jetons 2>/dev/null | tail -1)"
  echo "admin tAAPL : $(stellar contract invoke --id "$TAAPL" --source-account "$ADMIN" $N --send=no -- admin 2>/dev/null | tail -1) (attendu : le robinet)"
else
  echo "  [simulation] marche(), jetons(), admin() de tAAPL"
fi

etape "8. Configuration de l'appli (fichier à relire, PAS appliqué automatiquement)"
CIBLE="$FRONT/.env.production.new"
[ $EXECUTER -eq 0 ] && CIBLE="$FRONT/.env.production.simulation"
cat > "$CIBLE" <<EOF
# Généré par scripts/redeploy-testnet.sh le $(date '+%Y-%m-%d %H:%M'). Adresses PUBLIQUES. Aucun secret.
# À relire puis copier vers .env.production (commit + fusion → Vercel redéploie).
VITE_PRET_VERSION=2
VITE_PRET_ID=$PRET
VITE_ROBINET_ID=$ROBINET
VITE_DISTRIBUTEUR_ID=$DISTRIB
VITE_TAAPL_ID=$TAAPL
VITE_TUSDC_ID=$PRET_JETON
VITE_EMETTEUR_AAPL=$EA
VITE_EMETTEUR_USDC=$PRET_EMETTEUR
VITE_USDC_CODE=$PRET_CODE
EOF
echo "Écrit : $CIBLE"

etape "Reste à faire à la main"
cat <<EOF
1. Remplir la caisse du pool et la réserve du distributeur en $PRET_CODE :
   cd $FRONT
   \$env:ADMIN_SECRET = stellar keys show $ADMIN      (PowerShell, la clé reste dans la fenêtre)
   \$env:POOL_ID = "$PRET"; \$env:DISTRIBUTEUR_ID = "$DISTRIB"
   node scripts/recharger-usdc.mjs --tours 30 --distributeur 100 --pool 200
   Remove-Item Env:ADMIN_SECRET
2. Relire $CIBLE, le copier vers .env.production, commit, fusion → Vercel redéploie.
3. Parcours de contrôle avec un compte Varial neuf (TESTING.md, section 4).
EOF
