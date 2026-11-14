# Déployer UnlockShares sur testnet (Windows, PowerShell)

🏗️ L'image : on construit un petit marché.
1. On imprime deux monnaies de jeu, tAAPL et tUSDC.
2. On installe un distributeur de jetons, le robinet.
3. On ouvre le guichet de prêt.
4. On remplit la caisse.

Chaque étape se colle telle quelle dans **PowerShell**. Fais-les **une par une**, dans l'ordre, et vérifie le résultat attendu avant de passer à la suivante.

---

## Étape 1 : récupérer le projet et lancer les tests

1. Dézippe `unlockshares-app.zip` dans `C:\Users\grego\stellar` : tu obtiens le dossier `unlockshares-app`.
2. Colle :

```powershell
cd C:\Users\grego\stellar\unlockshares-app
cargo test
stellar contract build
```

✅ Résultat attendu :
- 2 lignes `test result: ok` (11 tests pour `pret`, 4 pour `robinet`) ;
- `pret.wasm` et `robinet.wasm` dans `target\wasm32v1-none\release`.

---

## Étape 2 : créer les deux émetteurs de jetons

```powershell
stellar keys generate emetteur-aapl --network testnet --fund
stellar keys generate emetteur-usdc --network testnet --fund
stellar tx new set-options --source-account emetteur-aapl --network testnet --set-required --set-revocable --set-clawback-enabled
```

✅ Résultat attendu : la dernière commande affiche un hash de transaction.

L'émetteur de tAAPL devient « sous contrôle », comme la DTC : il faut son accord pour détenir l'action, il peut geler les jetons et il peut les reprendre (clawback).

---

## Étape 3 : créer les deux jetons dans le monde des contrats (SAC)

```powershell
$EA = stellar keys public-key emetteur-aapl
$EU = stellar keys public-key emetteur-usdc
stellar contract asset deploy --asset "TAAPL:$EA" --source-account greg --network testnet --alias taapl
stellar contract asset deploy --asset "TUSDC:$EU" --source-account greg --network testnet --alias tusdc
```

✅ Résultat attendu : deux adresses qui commencent par `C`.

---

## Étape 4 : installer le robinet et lui confier les deux jetons

```powershell
$TAAPL = stellar contract alias show taapl --network testnet
$TUSDC = stellar contract alias show tusdc --network testnet
stellar contract deploy --wasm target\wasm32v1-none\release\robinet.wasm --source-account greg --network testnet --alias robinet -- --admin greg --action $TAAPL --dollar $TUSDC --montant_action 1000000000 --montant_dollar 50000000000 --delai 3600
$ROBINET = stellar contract alias show robinet --network testnet
stellar contract invoke --id taapl --source-account emetteur-aapl --network testnet -- set_admin --new_admin $ROBINET
stellar contract invoke --id tusdc --source-account emetteur-usdc --network testnet -- set_admin --new_admin $ROBINET
```

✅ Résultat attendu : une adresse `C...` pour le robinet, puis deux commandes sans erreur.

Le robinet donne **100 tAAPL et 5 000 tUSDC** par personne, au maximum une fois par heure.

---

## Étape 5 : ouvrir le guichet de prêt

```powershell
stellar contract deploy --wasm target\wasm32v1-none\release\pret.wasm --source-account greg --network testnet --alias unlockshares -- --admin greg --jeton_garantie $TAAPL --jeton_pret $TUSDC --prix 1000000000 --mode_demo true
$PRET = stellar contract alias show unlockshares --network testnet
stellar contract invoke --id robinet --source-account greg --network testnet -- autoriser --qui $PRET
```

✅ Résultat attendu : une adresse `C...` pour le contrat de prêt.

Réglages de départ :
- **prix** : 1 tAAPL = 100 tUSDC ;
- **mode démo** : n'importe qui peut changer le prix (bouton « Contrôles de démo »).

---

## Étape 6 : remplir la caisse avec 20 000 tUSDC

```powershell
stellar tx new change-trust --source-account greg --network testnet --line "TUSDC:$EU"
stellar contract invoke --id robinet --source-account greg --network testnet -- creer --qui greg --montant_action 0 --montant_dollar 200000000000
stellar contract invoke --id unlockshares --source-account greg --network testnet -- fournir --preteur greg --montant 200000000000
stellar contract invoke --id unlockshares --source-account greg --network testnet -- marche
```

✅ Résultat attendu : la dernière commande affiche `"caisse":"200000000000"`.

---

## Étape 7 : m'envoyer les adresses pour l'appli

```powershell
"PRET=$PRET"; "ROBINET=$ROBINET"; "TAAPL=$TAAPL"; "TUSDC=$TUSDC"; "EMETTEUR_AAPL=$EA"; "EMETTEUR_USDC=$EU"
```

Copie les 6 lignes dans le fil : je les mets dans l'appli.

---

## Si ça bloque

| Message | Cause probable | Solution |
|---|---|---|
| `$TAAPL` est vide | La fenêtre PowerShell a été fermée entre deux étapes | Relance les lignes `$... = ...` des étapes 3 à 5 |
| `op_no_trust` | La trustline n'existe pas | Refais la 1ʳᵉ ligne de l'étape 6 |
| `Error(Contract, #3)` | Caisse vide | Refais l'étape 6 |
| `Error(Auth, ...)` | Le mauvais compte signe | Vérifie le `--source-account` |

Rappel : redéployer crée un **nouveau** contrat, vide, avec une nouvelle adresse.

---

## Pool en USDC de Circle (pour le retrait MoneyGram)

MoneyGram n'accepte que l'USDC de Circle (testnet : `USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`, SAC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`).
Même contrat `pret`, seul le jeton prêté change. L'ancien pool tUSDC (`CC2I…564BS`) reste en ligne.

```powershell
stellar contract deploy --wasm target\wasm32v1-none\release\pret.wasm --source-account greg --network testnet --alias unlockshares-usdc -- --admin greg --jeton_garantie $TAAPL --jeton_pret CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA --prix 1000000000 --mode_demo true
$PRET = stellar contract alias show unlockshares-usdc --network testnet
stellar contract invoke --id robinet --source-account greg --network testnet -- autoriser --qui $PRET
```

Adresse : `CAMRWYRLSSFF5VJB6FKZSJO3QG3CQQDMJS77LTY3E5H7C67R2NYMUDVQ`.
Caisse : on la remplit avec de l'USDC du faucet Circle (faucet.circle.com, 20 USDC / 2 h), via la page **Earn → Lend** de l'appli.
Le robinet donne toujours du tAAPL (garantie) et du tUSDC (inutile pour ce pool).
