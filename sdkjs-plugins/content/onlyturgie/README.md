# Plugin ONLYOFFICE — LStJo (v2)

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
