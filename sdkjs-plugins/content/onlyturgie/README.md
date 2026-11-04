# Plugin ONLYOFFICE — LStJo (v2)

**Version courante : 2.1.31** (`config.json` → `version`).

### Document Server local (Docker)

Le dépôt est monté dans le conteneur sous **`sdkjs-plugins/{F7A4C9AF-…}/`** (avec accolades). L’URL HTTP correcte est :

`http://<ds>/sdkjs-plugins/%7BF7A4C9AF-2D3B-4C8C-A8D9-2F3A4B5C6D7E%7D/config.json`

Si l’éditeur affiche encore **2.1.26** après Ctrl+F5, ce n’est en général **pas** le cache du conteneur : le plugin est chargé depuis une **`baseUrl` d’installation** (souvent `https://onlyoffice.github.io/sdkjs-plugins/content/onlyturgie/` ou une ancienne install). **Désinstaller puis réinstaller** Onlyturgie depuis le marketplace local (`http://127.0.0.1:8090/store/`), ou forcer la `baseUrl` vers le montage GUID ci-dessus. L’icône panneau droit n’apparaît que **dans un document ouvert** (pas sur la page d’accueil), avec **Onlyturgie activé** dans Compléments.

Script : `./launch.sh` ou `launch.cmd` (voir `./launch.sh help`).

### Test rapide — aperçu PPTX (DocsAPI)

1. Document Server : `docker compose up -d` dans `onlyoffice-documentserver/` ; `curl -sf http://127.0.0.1:8080/healthcheck` → `true`.
2. Liturgie : `api_onlyoffice.jwt_secret` = `JWT_SECRET` du compose ; redémarrer PHP/Nextcloud si le fichier config est en cache.
3. Plugin **2.1.28+** monté dans le conteneur (volume compose) ou réinstall depuis `http://127.0.0.1:8090/store/` si l’éditeur charge encore une ancienne `baseUrl`.
4. Ouvrir un document ONLYOFFICE, activer Onlyturgie, panneau droit : ligne avec un chant ayant un `.pptx`, vérifier l’aperçu slide (pas de téléchargement).

Plugin **background** avec **Input helper** (comme le plugin officiel Autocomplete Ascensio) : la liste de suggestions suit le curseur pendant la frappe.

## Configuration

Tout se configure dans **`config.json`**, clé racine **`lstjo`** :

| Champ | Rôle |
|--------|------|
| **`apiPath`** | Chemin fixe sous l’hôte (défaut `/apps/liturgie/api`). |
| **`sourceUrlTemplate`** | Modèle des catalogues (défaut `{apiBase}/{source}?token={token}`). Placeholders : `{host}`, `{apiBase}`, `{apiPath}`, `{source}`, `{token}`. |
| **`sourceIds`** | (Optionnel) Liste des noms de sources ; si absent, liste intégrée au plugin (chant, kyrie, gloria, …). |
| **`sources`** | (Legacy) Objet ou liste pour surcharger des segments ; rarement nécessaire. |
| **`tagMap`** | (Optionnel) Associe un tag de contrôle de contenu à une clé de source. |
| **`defaultSource`** | Source utilisée si aucun tag ne correspond. |
| **`minChars`** | Nombre minimum de caractères du mot courant avant d’afficher l’assistant (défaut `1`). |
| **`maxResults`** | Nombre max de lignes proposées (défaut `20`). |
| **`inlineItems`** | Objet `sourceId → [ "ligne1", … ]` : suggestions de secours si pas de données chargées (ex. URL vide). |
| **`completionScope`** | `"full"` (défaut) : filtre avec **`GetCurrentSentence`** et remplace avec **`ReplaceCurrentSentence`** — toute la **phrase** courante dans le document (pas le fragment reconstruit par l’Input helper). `"word"` : mot courant + `InputText` (style dictionnaire). |
| **`helperWidth`** / **`helperMaxWidth`** | Largeur de la liste (mêmes unités que le code officiel, ex. base ~150 → ici 340 par défaut, plafond 920). |
| **`panel.autoOpenOnDocument`** | `true` (défaut) : au chargement du document, rouvre le panneau via `ShowWindow`. `false` désactive **uniquement** cette réouverture au document ; le panneau s’ouvre toujours à **l’activation** du plugin. |
| **`panel.autoOpenCollapsed`** | Si `true`, le panneau est accroché à la barre droite mais replié (`isActivated: false`). |

**Panneau (v2.1.21+)** : en-tête avec toggle autocomplétion (`onlyturgie.autocompleteEnabled`), engrenage → modale paramètres, version semver. Ratio PDF / présentation **50/50** à chaque ouverture du panneau. Si plusieurs PDF ou PPT dans un dossier chant : liste déroulante lorsque l’API renvoie `files[]` ou que `GET …/api/pdf/list` / `ppt/list` répond (sinon un seul fichier via `/api/pdf` — voir liturgie-nc).

**Présentation sans viewer Microsoft (`pptUseOfficeViewer: false`, v2.1.28+)** : le volet bas n’utilise plus une iframe directe sur `/api/ppt/file` (téléchargement). Le panneau charge `web-apps/apps/api/documents/api.js` et instancie `DocsAPI.DocEditor` (mode **view**, type **slide**). La config (dont JWT) est obtenue via **`GET /apps/liturgie/api/onlyoffice/panel-config?documentUrl=…`** (même auth que `/api/ppt`). Côté Liturgie, `config/menu.config.json` → **`api_onlyoffice.jwt_secret`** (aligné sur `JWT_SECRET` du Document Server Docker) ; repli possible sur le secret de l’app Nextcloud **ONLYOFFICE**. Optionnel : **`document_server_url`**, **`document_url_from` / `document_url_to`** si le DS doit joindre Nextcloud sur un autre hôte que l’URL publique. Plugin : **`lstjo.panel.documentServerUrl`** (vide = origine de l’éditeur), **`pptOnlyOfficeConfigUrlTemplate`**.

**Barre latérale droite ONLYOFFICE** : variation `panelRight` (2e de `variations[]`) ouverte par `ShowWindow` depuis le background (`lstjo-runtime.js`). La variation `background` doit rester **en tête** : ONLYOFFICE n’autostarte que `variations[0]` et ne classe le plugin « en arrière-plan » que d’après elle — sinon l’autocomplétion ne démarre pas. Ne pas mettre `isInsideMode: true` sur le panneau : cela évite l’icône sur la nav droite. Le plugin **Onlyturgie** (background) doit rester activé dans Compléments.

L’**hôte** (`https://…`), le **mode d’auth** et le **jeton API** sont saisis via **Onlyturgie — paramètres** (`onlyturgie.apiHost`, `onlyturgie.authMode`, `onlyturgie.apiToken`). Ils ne sont pas dans `config.json` (sauf `lstjo.authMode` par défaut : `auto`).

### Authentification (jeton vs session Nextcloud)

| Mode | Usage |
|------|--------|
| **Jeton** | ONLYOFFICE Desktop ou Document Server : URLs `…/api/chant?token=…` (compte fichier = `user_id` du `menu.config.json`). |
| **Session Nextcloud** | Pas de jeton dans l’URL : l’API liturgie utilise l’utilisateur connecté (`IUserSession`). Requêtes avec cookies (`credentials: include`). |
| **Automatique** | Jeton si renseigné dans les paramètres, sinon session si l’hôte est défini. |

L’app Nextcloud **liturgie** accepte déjà les deux (voir `LiturgieApiController`). Si ONLYOFFICE est sur **un autre domaine** que Nextcloud, les cookies de session ne partent en général pas : gardez le **mode jeton** et `api_chants.cors_origin` = URL du Document Server (pas `*` si vous testez les cookies).

Les **URLs complètes** peuvent encore être surchargées par le stockage local (`jsonAutocomplete.urls`, ancienne version).

Au démarrage, le plugin **télécharge** chaque source dont l’URL est résolue (jeton + base) et met en cache les listes (`jsonAutocomplete.itemsBySource`).

## Tags de contrôle

Comme en v1 : `source:nom`, nom égal à une clé, ou entrées dans **`tagMap`**.

## Déploiement (Desktop)

Depuis le dossier `onlyturgie` : `.\deploy-local.ps1` puis redémarrer ONLYOFFICE.

## Variation `config.json`

- `"type": "background"` — plugin non visible comme panneau latéral.
- `"events": ["onInputHelperClear", "onInputHelperInput"]` — branchement assistant de saisie.
