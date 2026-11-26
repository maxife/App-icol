# Guide de Déploiement en Production — App-icol (5 minutes)

Ce guide décrit pas à pas comment relier **App-icol** au classeur Google Sheets **« Vente et reservations Miel »** via Google Apps Script (`clasp`) et publier l'application PWA Mobile-First sur un hébergement statique gratuit (**GitHub Pages**, **Vercel**, **Netlify** ou **Cloudflare Pages**).

---

## 1. Prérequis & Création du Client OAuth Google Identity Services

1. Ouvrez la [Console Google Cloud](https://console.cloud.google.com/apis/credentials) et sélectionnez (ou créez) un projet léger **App-icol**.
2. Dans **Écran d'autorisation OAuth**, configurez le nom `App-icol` (type *Externe* ou *Interne*).
3. Dans **Identifiants -> Créer des identifiants -> ID client OAuth** :
   - Type d'application : **Application Web**.
   - **Origines JavaScript autorisées** : ajoutez l'URL finale de votre hébergement (ex. `https://votre-compte.github.io` ou `https://app-icol.vercel.app`) ainsi que `http://localhost:5173` pour vos essais locaux.
4. Copiez l'identifiant généré (`xxxx.apps.googleusercontent.com`) : ce sera votre `GOOGLE_CLIENT_ID`.

---

## 2. Préparation et Audit à Blanc du Classeur Google Sheets

> **Recommandation importante :** effectuez d'abord ce premier branchement sur une **copie de test** du classeur *« Vente et reservations Miel »* afin de valider l'alignement des en-têtes sans risque.

1. Ouvrez le classeur Google Sheets et relevez son identifiant dans l'URL :
   `https://docs.google.com/spreadsheets/d/<VOTRE_SPREADSHEET_ID>/edit`
2. Compilez le bundle Google Apps Script V8 (`dist/Code.gs` + `dist/appsscript.json`) depuis la racine du dépôt :
   ```bash
   npm run build
   ```
3. Déployez vers Google Apps Script avec `@google/clasp` :
   ```bash
   npx @google/clasp login
   cp packages/gas-api/.clasp.json.example packages/gas-api/.clasp.json
   # Renseignez votre scriptId dans packages/gas-api/.clasp.json (ou créez-le via clasp create --type webapp --rootDir packages/gas-api/dist)
   npx @google/clasp push --project packages/gas-api/.clasp.json
   ```

---

## 3. Configuration des `ScriptProperties` dans Google Apps Script

1. Ouvrez votre projet dans l'éditeur Google Apps Script (`npx @google/clasp open --project packages/gas-api/.clasp.json`).
2. Allez dans **Paramètres du projet (icône engrenage) -> Propriétés du script** et ajoutez les clés suivantes :

| Propriété (`ScriptProperties`) | Description & Exemple |
| :--- | :--- |
| `SPREADSHEET_ID` | ID du classeur Google Sheets « Vente et reservations Miel » |
| `GOOGLE_CLIENT_ID` | ID Client OAuth Web (`xxxx.apps.googleusercontent.com`) |
| `MANAGER_EMAILS` | Liste d'e-mails des gestionnaires séparés par des virgules (ex. `apiculteur@gmail.com`) |
| `CONTRIBUTOR_EMAILS` | *(Optionnel)* Liste d'e-mails des co-vendeurs autorisés (ex. `covendeur@gmail.com`) |
| `SCHEMA_OVERRIDES_JSON` | *(Optionnel)* Surcharge JSON d'alias d'en-têtes si un intitulé personnalisé est signalé par l'audit |

3. **Exécution de l'audit en lecture seule `inspectSheetStructure()` :**
   - Dans la barre d'outils de l'éditeur Apps Script (`Code.gs`), sélectionnez la fonction **`inspectSheetStructure`** et cliquez sur **Exécuter**.
   - Autorisez l'accès Google Sheets au premier lancement.
   - Vérifiez le rapport JSON dans le journal d'exécution :
     - Les 8 onglets actifs (`Ventes Miel`, `ParRecoltes`, `ParCommandes`, `ParPaiement`, `ParArticles`, `PUan`, `Gestion recoltes`, `Comptabilité rucher`) doivent afficher `exists: true` et `missingRequiredFields: []`.
     - Les 4 onglets protégés (`App: Logins`, `App: Metadata`, `ParNbPots`, `TEST - NE PAS TOUCHER`) sont strictement ignorés et verrouillés par `SheetGuard`.
     - Les formules `R1C1` / `ARRAYFORMULA` existantes (`Poids (Kg)`, `Prix`) et le format texte `'@'` des numéros de téléphone sont automatiquement préservés.

4. **Publication de l'endpoint Web App :**
   - Cliquez sur **Déployer -> Nouveau déploiement -> Application Web**.
   - **Exécuter en tant que** : *Moi* (`USER_DEPLOYING`).
   - **Qui peut accéder** : *Tout le monde* (`ANYONE_ANONYMOUS` — la sécurité privée est assurée à chaque appel `doPost` par la vérification cryptographique du `idToken` Google et des listes `MANAGER_EMAILS` / `CONTRIBUTOR_EMAILS`).
   - Copiez l'URL de l'application Web se terminant par `/exec` : ce sera votre `VITE_GAS_WEBAPP_URL`.

---

## 4. Build et Hébergement Statique du Frontend PWA (`packages/web`)

Définissez les variables d'environnement de production lors du build (dans les secrets **GitHub Actions / GitHub Pages**, **Vercel**, **Netlify** ou **Cloudflare Pages**) :

```env
VITE_DATA_MODE=gas
VITE_AUTH_MODE=gis
VITE_GAS_WEBAPP_URL=https://script.google.com/macros/s/VOTRE_DEPLOYMENT_ID/exec
VITE_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
```

Commande de build et dossier de sortie à configurer sur l'hébergeur :
- **Build command** : `npm ci && npm run build`
- **Publish / Output directory** : `packages/web/dist`

### 4.1 Déploiement automatique via GitHub Pages (`.github/workflows/deploy.yml`)

Le dépôt inclut déjà le workflow GitHub Actions **CI & Deploy App-icol PWA** (`.github/workflows/deploy.yml`) :

1. **Visibilité du dépôt** : sur un compte **GitHub Free**, GitHub Pages nécessite que le dépôt soit **Public** (*Settings -> General -> Danger Zone -> Change repository visibility -> Make public*), ou un abonnement GitHub Pro pour un dépôt privé *(à noter : le code source ne contient aucun secret ni donnée client — les vraies données restent dans votre Google Sheet privé, protégé côté Apps Script par `GOOGLE_CLIENT_ID` et `MANAGER_EMAILS` / `CONTRIBUTOR_EMAILS`)*. Si vous préférez conserver le dépôt privé gratuitement, connectez-le simplement à **Cloudflare Pages**, **Vercel** ou **Netlify**.
2. **Activation de GitHub Pages** : dans **Settings -> Pages -> Build and deployment -> Source**, sélectionnez **GitHub Actions**.
3. **Variables optionnelles (liaison Google Sheets)** : dans **Settings -> Secrets and variables -> Actions -> Variables**, ajoutez `VITE_DATA_MODE`, `VITE_AUTH_MODE`, `VITE_GAS_WEBAPP_URL` et `VITE_GOOGLE_CLIENT_ID` (sans ces variables, l'application déployée tourne de façon autonome en mode démonstration `localStorage`).

*(Grâce à `base: './'`, `.nojekyll` et au routeur par hash `#/dashboard`, l'application fonctionne aussi bien à la racine d'un domaine Vercel/Netlify que dans un sous-dossier GitHub Pages `https://<user>.github.io/App-icol/`, et s'installe hors-ligne sur l'écran d'accueil iOS / Android).*
