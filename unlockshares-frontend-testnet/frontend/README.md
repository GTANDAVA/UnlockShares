# UnlockShares : frontend de démonstration

Application React + TypeScript + Vite + Tailwind CSS, commune à l'équipe, au style de la maquette V3 HackMeridian.

- **Pages de démonstration** (copie de la maquette V3, données de Léa simulées dans `src/services/mockDemo.ts`) : Accueil, Activité, Prêter et gagner, Emprunter, Contrôles de démo. Aucune transaction, aucun portefeuille connecté.
- **Simulateur de risque branché sur l'API** : Évaluation (faite), Simulation de liquidation et Aide (réservées au camarade, prompt 3).

## Lancer le projet

Prérequis : Node.js 20 ou plus récent.

```bash
npm install          # une seule fois
cp .env.example .env # Windows : copy .env.example .env
npm run dev          # ouvre http://localhost:5173
```

Autres commandes :

```bash
npm run build    # vérifie les types puis compile dans dist/
npm run preview  # sert la version compilée
npm run lint     # oxlint
```

## Configuration (.env)

| Variable | Valeurs | Rôle |
|---|---|---|
| `VITE_API_MODE` | `mock` ou `http` | `mock` : réponses simulées. `http` : appels au backend. |
| `VITE_API_URL` | ex. `http://localhost:8000` | Adresse du backend, obligatoire en mode `http`. |

Les variables `VITE_` sont visibles dans le navigateur : **ne jamais y mettre de secret**.
Une valeur inconnue ou une URL vide en mode `http` affiche un avertissement sous l'en-tête.

## Vérifier le résultat (mode simulé)

0. Accueil : solde 10 000 €, 37 % de la limite utilisée. Contrôles de démo : prix à 70 €, jauge « Danger », bouton du liquidateur actif.
1. Page Évaluation, choisir l'exemple **Position saine**, cliquer **Évaluer** : valeur 1 000,00 €, dette 500,00 €, LTV 50 %, Health Factor 1,52, ouverture autorisée.
2. Exemple **Sans dette (hypothèse)** : Health Factor « Non applicable ».
3. Saisir d'autres valeurs : message « Aucun scénario simulé pour ces valeurs ».
4. Champs vides ou négatifs : messages d'erreur sous les champs, aucun appel.
5. **Réinitialiser** vide le formulaire et le résultat.

## Structure

```
src/
  types/api.ts            Types conformes aux JSON du contrat d'API
  config.ts               Lecture de VITE_API_MODE / VITE_API_URL
  services/riskApi.ts     SEUL point d'appel réseau (choisit mock ou http)
  services/mockRiskApi.ts Scénarios simulés (évaluation + devis de liquidation)
  services/mockDemo.ts    Données et actions de démo de Léa (backend simulé des pages V3)
  styles/meridian.css     Styles repris de la maquette V3
  components/demo.tsx     Jauge, bocal d'actions, fenêtres d'action, toast
  pages/HomePage.tsx, ActivityPage.tsx, EarnPage.tsx, BorrowPage.tsx, DemoPage.tsx
  services/validate.ts    Contrôle de forme des réponses (pas de calcul métier)
  services/errors.ts      Types d'erreurs (métier, HTTP, réseau, inattendue...)
  lib/format.ts           Centimes -> euros, points de base -> %, HF
  components/Layout.tsx   En-tête, badges Démonstration / mode, navigation
  pages/EvaluatePage.tsx  Page Évaluation
  pages/LiquidationPage.tsx, pages/HelpPage.tsx  Emplacements du camarade
```

Les pages n'effectuent **aucun calcul de risque** : elles affichent les réponses de `riskApi` ou, pour les pages de démo, de `mockDemo.ts`. Ce dernier devra être remplacé par de vraies routes backend (position, pool, taux, historique) qui n'existent pas encore.

## Pour le camarade (prompt 3)

- Appeler `riskApi.liquidationQuote(req)` depuis `src/services/riskApi.ts`, ne pas créer d'autre service.
- Ajouter des scénarios dans `liquidationScenarios` de `src/services/mockRiskApi.ts` (un exemple « devis-brief » existe déjà).
- Réutiliser `Card` (`components/Layout.tsx`) et `formatCents` / `formatBpsPercent` (`lib/format.ts`).

## Points du contrat d'API à confirmer

1. Erreur métier en **442** : statut inhabituel, probablement **422** voulu. Le code traite tout 4xx avec `message` comme erreur métier.
2. `risk_level` : seule la valeur `healthy` est documentée. Les autres s'affichent « Niveau non documenté ».
3. Cas `health_factor_bps: null` non illustré : le scénario « Sans dette » est une **hypothèse**.
4. Aucun exemple d'erreur pour `/risk/evaluate`.
5. HF 15200 pour une LTV de 50 % implique un seuil de liquidation de 76 %, alors que la maquette indique 80 %.
6. Bonus de liquidation de 5 % déduit de l'exemple, non écrit.
7. Non précisés : quantité entière ou décimale, URL et port du backend, CORS, plafond de remboursement partiel.
