#!/usr/bin/env bash
# OC1 + OC2 (autorisés par Greg) : coupe mode_demo sur les 2 pools testnet, signé par la clé locale "greg".
# Envoie uniquement si mode_demo est encore true. Usage : bash scripts/oc1-oc2.sh
set -uo pipefail
for P in CAMRWYRLSSFF5VJB6FKZSJO3QG3CQQDMJS77LTY3E5H7C67R2NYMUDVQ CC2IWLMTGP3F4WG4TOYOCE7ZOYD4KRE4R4AXPTVUWX6UWGUK2ID564BS; do
  echo "== $P"
  M=$(stellar contract invoke --id $P --source-account greg --network testnet --send=no -- marche 2>/dev/null | tail -1)
  if printf '%s' "$M" | grep -q '"mode_demo":true'; then
    stellar contract invoke --id $P --source-account greg --network testnet -- fixer_mode_demo --actif false 2>&1 | grep -o 'Signing transaction: [0-9a-f]\{64\}\|Error.*' | tail -1
  else
    echo "deja a false, rien envoye"
  fi
  echo "verif: $(stellar contract invoke --id $P --source-account greg --network testnet --send=no -- marche 2>/dev/null | tail -1 | grep -o '"mode_demo":[a-z]*')"
done
