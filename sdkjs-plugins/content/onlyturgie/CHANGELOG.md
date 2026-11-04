# Changelog

## 2.1.50

- Connexion sans jeton à recopier : page `install.html` avec un favori « ⛪ Connecter Onlyturgie ». Sur la page Nextcloud (document ouvert, panneau Onlyturgie ouvert), il obtient un jeton personnel (`/apps/liturgie/api/onlyturgie-token`, réservé aux groupes `api_chants.groupes_session`) et le transmet au plugin par `postMessage` (origine vérifiée).

## 2.1.49

- Playlist et diaporama : les répétitions sont conservées dans l’ordre du document (ex. « Bienvenue - Logo Saint Joseph » au début et à la fin). Les partitions restent copiées une seule fois.

## 2.1.48

- Pied du panneau : les diapos citées (catalogue `/api/diapo` : « Diapos » du docx puis `Visionneuse/Commun`, ex. « Bienvenue - Logo Saint Joseph ») sont intégrées à la playlist (`.ppt`) et au diaporama (`.pptx`), dans l’ordre du document. Elles sont ignorées par « Récupérer les partitions ».

## 2.1.47

- La playlist s’appelle désormais `liste_diapos.playlist.txt` (au lieu de `diapos.playlist`) : l’app liturgie l’ouvre en aperçu ANSI dans Fichiers.

## 2.1.46

- Autocomplétion dans un contrôle de contenu : le choix remplace seulement le contenu du contrôle (au lieu de `ReplaceCurrentSentence`, qui effaçait toute la phrase autour d’un contrôle inline).

## 2.1.45

- Tags de contrôle de contenu `animateurs`, `musiciens`, `lecteurs`, `diapo`, `pu`, `psaume` : l’autocomplétion propose les membres du groupe Nextcloud du même nom (`/api/contacts-{tag}`), prioritaire sur les catalogues homonymes. Une cellule « Diapo » sans tag garde le catalogue des diapos.

## 2.1.44

- Popup de résultat (partitions, playlist, diaporama) illisible en thème sombre : le thème de l’éditeur recolorait le texte en clair sur le fond blanc de la popup. Couleurs du texte fixées dans la popup.

## 2.1.43

- Gel possible au bout d’un moment : l’autocomplétion lançait un `callCommand` par frappe (lecture de la cellule de gauche), en concurrence avec les `callCommand` du panneau relayés par le background. Le panneau publie désormais « curseur dans une cellule diapo » (`onlyturgie.cursorCell`) et l’autocomplétion le lit ; repli sur `callCommand` seulement si le panneau est fermé.

## 2.1.42

- Diapos : le catalogue `diapo` donne les fichiers sans extension `.ppt`/`.pptx` (l’API les résout par nom de base).
- Aperçu diapo à droite : la requête liste (`/api/ppt/all`) ne recevait pas `scope=diapo` ni le contexte du document → 404 dans le dossier chants. Elle reprend désormais le même périmètre que la requête principale.

## 2.1.41

- Diapos : l’API cherche dans le sous-dossier `Diapos` du dossier contenant le docx ouvert, puis dans `01. Menus/Visionneuse/Commun` (au lieu de « 04. Diapos »). Le catalogue `diapo` et les requêtes `ppt` en `scope=diapo` transmettent `key` / `callbackUrl` du document (publiés par le background dans `onlyturgie.docContext` pour le panneau).

## 2.1.48

- Diapo directe : hors contrôle de contenu, si la cellule de gauche (même ligne de tableau) commence par « Diapo », l’autocomplétion propose le catalogue `diapo` et le panneau affiche la présentation correspondante (pas de PDF).
- API liturgie : `/api/diapo` liste aussi les `.ppt`/`.pptx` posés directement dans le dossier diapos ; les routes `ppt` acceptent `scope=diapo` (sous-dossier ou fichier direct, nom avec ou sans extension).

## 2.1.39

- Pied du panneau : chaque bouton ouvre une popup de résultat. Partitions : copiées (vert), déjà présentes (bleu), dossiers sans partition (rouge). Playlist : aperçu de `diapos.playlist` et chants sans `.ppt` (rouge). Diaporama : `.pptx` intégrés (vert), dossiers sans `.pptx` (rouge).
- La playlist s’appelle désormais `diapos.playlist` (au lieu de `playlist.txt`).

## 2.1.38

- Pied du panneau : barre de trois boutons (icône + infobulle) reliés à l’app Nextcloud liturgie. Le texte du document est lu par le background (`onlyturgie.collectDocument` → `onlyturgie.documentSnapshot`), les chants du catalogue cités sont envoyés avec la clé ONLYOFFICE du document (`Asc.plugin.info.documentId`, à défaut l’URL de suivi) :
  - **Récupérer les partitions** (`POST /api/menu/partitions`) : copie les PDF des chants dans `Partitions/` à côté du docx.
  - **Générer playlist** (`POST /api/menu/playlist`) : met à jour `playlist.txt` à côté du docx — uniquement des `.ppt`, un par chant dans l’ordre du document, chemins relatifs au dossier du docx avec `\`, encodage ANSI (Windows-1252), fins de ligne CRLF.
  - **Générer diaporama** (`POST /api/menu/diaporama`) : fusionne uniquement les `.pptx` des chants en `<nom du docx>.ppsx` à côté du docx. Indépendant de la playlist.

## 2.1.37

- Panneau figé sur « Chargement… » (init jamais reçu) : ouvert depuis le background par `ShowWindow` brut, il n’avait ni `?windowID=` dans l’URL ni enregistrement dans `Asc.plugin._windows`. Ouverture via `Asc.PluginWindow` (id alphanumérique, `windowID`, relais des `executeMethod` / `callCommand` du panneau par le background).
- `onTargetPositionChanged` : abonné côté background et relayé au panneau (`forwardEventToPanelWindow`) — une fenêtre enfant ne reçoit pas les événements éditeur.
- Paramètres depuis le panneau : délégués au background (`onlyturgie.openSettings`) au lieu d’un `PluginWindow` créé dans la fenêtre enfant.

## 2.1.36

- Panneau ouvert par le background : « 404 Not Found ». L’éditeur charge `variation.url` de `ShowWindow` tel quel, relatif à sa page (`web-apps/apps/documenteditor/main/panel.html`). URL absolue construite depuis le dossier du plugin (`resolvePluginFileUrl`), aussi pour la fenêtre Paramètres.

## 2.1.35

- Correctif 2.1.34 : `ShowWindow` du panneau depuis le background utilisait l’identifiant `iframe_asc.{GUID}` ; l’éditeur en fait un sélecteur jQuery (`#panel-plugins-…`) invalide à cause de `.`, `{`, `}` → exception et message « Une erreur s’est produite lors du travail avec le document ». Identifiant fixe `onlyturgie_panel`.

## 2.1.34

- Autocomplétion : la variation **background** (`index.html`) repasse en **tête de `variations[]`**. ONLYOFFICE (`Plugins.js`) ne lance en autostart que la variation 0 (`asc_pluginRun(guid, 0)`) et ne reconnaît un plugin « en arrière-plan » que d’après `variations[0].type`. Depuis 2.1.4 (panneau en tête), l’autostart ouvrait le panneau et l’assistant de saisie ne démarrait jamais seul. Le panneau est désormais ouvert par le background via `ShowWindow` au démarrage.
- Bloc `store` (marketplace) déplacé sur la variation 0, lue par la carte du store.

## 2.1.33

- Présentation (DocsAPI) : **ne se rechargeait plus après la première ouverture**. `DocsAPI.DocEditor` remplace l’élément cible par son iframe (et en remet un nu au destroy) : `#oo-ppt-editor` disparaissait, `bindPptPaneViaDocsApi` sortait aussitôt → changement de chant ou de fichier sans effet. L’éditeur est désormais créé dans une div enfant jetable (`#oo-ppt-editor-frame`) ; `#oo-ppt-editor` reste le conteneur stable.
- Volets : `onTargetPositionChanged` se répète (~0,4 s) et réapplique les volets. Un chargement en cours (panel-config, téléchargement PDF) n’est plus annulé / relancé à chaque répétition ; un fichier en erreur n’est retenté qu’après 15 s (au lieu d’une boucle de requêtes).
- Menu de fichiers (plusieurs PDF / présentations) : le fichier choisi n’est plus remplacé ~0,4 s plus tard par le fichier par défaut ; le choix est mémorisé (cache 5 min).
- Un chargement en cours ne s’affiche plus sur un chant sans fichier (PDF ou présentation).

## 2.1.32

- Panneau : aperçus PDF / présentation plus rapides.
  - Chaque volet s’affiche **dès que sa propre requête répond** (le PDF n’attend plus la présentation).
  - Appel direct à `/api/{pdf|ppt}/all` (une requête au lieu de `/api/pdf` puis `/all`) ; repli sur `/api/pdf` / `/api/ppt` seulement si la route liste est absente (ancien serveur Liturgie).
  - Cache des chants récents (5 min, 60 entrées) et des PDF déjà téléchargés (12 blobs) : revenir sur un chant est instantané. Vidé à l’enregistrement des paramètres.
  - `api.js` ONLYOFFICE préchargé à l’ouverture du panneau si `pptUseOfficeViewer: false` et `documentServerUrl` renseigné ; rechargé si panel-config renvoie un autre Document Server ; nouvel essai possible après un échec de chargement.
- Nécessite Liturgie ≥ 1.0.5 pour le cache HTTP des fichiers (URL `/file?…&v=<etag>`), mais reste compatible avec les versions antérieures.

## 2.1.31

- Autocomplétion : filtre sur le **fragment saisi** (ligne Input helper) en mode `completionScope: full`, au lieu de la phrase entière du document (souvent aucune correspondance).
- Panneau → background : après chargement du catalogue chant, écriture `jsonAutocomplete.itemsBySource` + événement `onlyturgie.catalogUpdated` (recharge l’assistant si le background n’avait pas pu fetch seul).
- Scripts background (`index.html`) cache-bust aligné sur la version manifeste (`?v=2.1.31`) — évite un panneau 2.1.30+ avec un `plugin.autocomplete.js` encore en cache 2.1.27.

## 2.1.30

- (Travail local non tagué — voir commits / diff ; PPTX DocsAPI, messages d’erreur panneau, etc.)

## 2.1.29

- Panneau PPTX DocsAPI : envoi du nom de fichier (`title`) à l’API panel-config pour `fileType` ppt/pptx correct.
- Config plugin : `documentServerUrl` par défaut `http://onlyoffice.test:8080/` (Liturgie : voir correctif `type: embedded` côté API).

## 2.1.28

- Panneau : si `lstjo.panel.pptUseOfficeViewer` est `false`, aperçu PPTX via **DocsAPI** (`DocEditor`, mode view, slide) au lieu d’une iframe sur l’URL fichier Liturgie.
- Config panneau : `documentServerUrl`, `pptOnlyOfficeConfigUrlTemplate` ; API Liturgie `GET /api/onlyoffice/panel-config` + `menu.config.json` → `api_onlyoffice` (JWT aligné Document Server).

## 2.1.27

- Nav droite : retrait de `isInsideMode` sur la variation panneau (`config.json` + `buildPanelShowWindowVariation`) — avec `panelRight`, ce flag empêchait l’icône Onlyturgie d’apparaître sur la barre latérale droite (doc ONLYOFFICE : utiliser `type`, pas `isInsideMode`).
- Nav droite : `ShowWindow` retenté à l’activation du background (0 / 600 / 1800 ms) si l’éditeur n’était pas encore prêt au premier `init`.

## 2.1.26

- Panneau : PDF et Présentation ont la même hauteur (50 / 50). L’ancien ratio enregistré n’est plus relu.
- Nav droite : la variation panneau est en mode intégré (`isInsideMode`) pour poser le bouton « L » ; à la fermeture du panneau, le bouton est raccroché sans rouvrir le panneau.

## 2.1.25

- Panneau : PDF et Présentation occupent toute la hauteur sous le statut. Le bandeau identifiants masqué ne laissait plus de piste de grille, et la zone partagée restait collée en haut au-dessus d’un grand vide.

## 2.1.24

- Panneau : split PDF / PPT **60 / 40** (grille `3fr` / `2fr`, défaut `0.6`) comme en **2.1.14** ; ratio utilisateur relu depuis `onlyturgie.panelPdfRatio` (plus de reset 50/50 à chaque ouverture).
- Panneau : grille `#root` corrigée (4 lignes pour 4 blocs) — la zone split occupe bien le `1fr` restant ; en-tête en `flex-wrap` pour éviter le chevauchement des contrôles dans un panneau étroit.

## 2.1.23

- Panneau : indicateur d’état **API chant** dans l’en-tête (spinner / tic vert / croix rouge) selon la requête catalogue Liturgy (`loadChantList`).

## 2.1.22

- Panneau : toggle autocomplétion refait — libellé explicite « Autocomplétion : activée / désactivée », pastille on/off, `role="switch"` ; lecture/écriture `onlyturgie.autocompleteEnabled` + `onlyturgie.autocompleteToggled` vers le background.
- Nav droite : `ShowWindow` avec `isActivated: false` à l’activation pour garder l’icône panneau visible même panneau fermé (ONLYOFFICE 8.3+).

## 2.1.21

- Panneau : en-tête (toggle autocomplétion → engrenage paramètres → version lue depuis `Asc.plugin.info` / `config.json`), persistance `onlyturgie.autocompleteEnabled`, ratio PDF/PPT **50/50** à chaque ouverture.
- Background : autocomplétion liturgique respecte le toggle ; ouverture auto du panneau à **l’activation du plugin** (`showOnlyturgiePanel`) + au document si `lstjo.panel.autoOpenOnDocument` ≠ false.
- Panneau : `path_full` PDF/PPT en état de résolution ; listes déroulantes si plusieurs fichiers (réponse `files[]` ou tentative `GET …/api/pdf/list` / `ppt/list` — voir README si API absente).
- **Nav droite ONLYOFFICE** : la variation `panelRight` en tête de `config.json` + `ShowWindow` enregistrent l’icône lorsque l’éditeur le permet ; pas de contrôle plugin-only sur la visibilité permanente de la barre latérale (limitation éditeur).

## 2.1.20

- Paramètres : ouverture via `PluginWindow` (modale) depuis le panneau (bouton « Paramètres (hôte / jeton)… ») ou le menu contextuel ; le panneau droit est réaffiché à la fermeture. Éviter **Compléments → Onlyturgie — paramètres** (remplace le panneau).

## 2.1.19

- Panneau PDF : chargement via `fetch` + URL blob (contourne X-Frame-Options Nextcloud / message Firefox « intégrée par un autre site »).

## 2.1.18

- Panneau : fin du clignotement des aperçus PDF/PPT — pas de rechargement iframe si l’URL est inchangée ; une seule paire d’appels API `/api/pdf` + `/api/ppt` par chant (cache chant, requête en vol, callbacks curseur périmés ignorés).

## 2.1.17

- Panneau : ouverture automatique à l’ouverture du document (`ShowWindow` + `lstjo.panel.autoOpenOnDocument`, défaut `true`) ; icône barre droite sans passer par le menu Compléments.
- Prérequis : variation **Onlyturgie** (background / autocomplétion) activée une fois dans l’éditeur (état mémorisé). Désactiver : `lstjo.panel.autoOpenOnDocument: false` ; panneau replié au démarrage : `autoOpenCollapsed: true`.

## 2.1.16

- Hash PDF/PPT (`{base64url}`) : base64 UTF-8 du chemin ou nom **brut** (espaces, `/`), sans `encodeURIComponent` avant base64 (évite `%20` / `%2F` après décodage côté liturgie).

## 2.1.15

- Panneau : messages d’erreur PDF/PPT explicites (HTTP 404/403, JSON, URL racine) au lieu du message générique sur la clé `url`.
- Panneau : resync hôte/jeton à chaque rafraîchissement + après OK « Onlyturgie — paramètres ».
- `resolvePanelApiTemplate` : conserve `{base64url}` (et placeholders chant) après résolution de `{apiBase}` / `{token}`.

## 2.1.12

- Libellés de variation paramètres sans version figée (évite l’affichage « v2.1.8 » dans le menu).
- Store buu-lam : rechargement de `config.json` à l’install / mise à jour (`fetchFreshPluginConfigForInstall`).

## 2.1.11

- Panneau : cache `lastSettledResolve` appliqué avant l’invalidation `resolveSeq` ; scripts `panel.js` / `lstjo-runtime.js` avec `?v=2.1.11` pour limiter le cache navigateur.

## 2.1.10

- Panneau : mémorisation du dernier résultat (ligne + chant) pour ne pas relancer les appels PDF/PPT quand `onTargetPositionChanged` se répète (fin du clignotement Chargement / erreur API).

## 2.1.9

- Background : `lstjoReloadAutocompleteFromStorage`, `refreshAfterSettingsSave`, écoute `onlyturgie.settingsSaved` ; synchro catalogues après OK paramètres.
- `plugin-settings-bridge.js` : ne court-circuite plus le rechargement des catalogues.

## 2.1.8

- Version affichée en bandeau dans la fenêtre paramètres ; titre de variation et description du store incluent `v2.1.8` (l’écran d’installation ONLYOFFICE reste celui du gestionnaire, qui lit déjà `version` dans `config.json`).

## 2.1.7

- Libellé du bouton de test : « Tester le catalogue chant » (sans guillemets, pour éviter une lecture « champ »).

## 2.1.6

- Paramètres : bouton « Tester le catalogue chant » (résultat HTTP / nombre d’entrées / erreur).
- Après OK : `notifySettingsSaved` (postMessage + `sendToPlugin`) pour recharger les catalogues dans le background sans F5.
- Précision : le localStorage des réglages est celui de l’iframe plugin (pas la page Nextcloud).

## 2.1.5

- Ouverture des paramètres depuis le plugin background : entrée de menu contextuel « Paramètres Onlyturgie » (`Asc.PluginWindow` → `settings.html`, 440×280, OK).

## 2.1.4

- Variations réordonnées : panneau (`panelRight`) en premier, puis autocomplétion (`background`), puis paramètres (`type: window`).
- `isVisual: false` sur le background ; métadonnées `store` sur la variation panneau.

## 2.1.3

- Double mode d’auth : jeton API (Desktop) ou session Nextcloud (`authMode`, URLs sans `?token=`, `fetch` avec cookies).
- Paramètres : choix Automatique / Jeton / Session Nextcloud.

## 2.1.1

- URLs des catalogues via modèle (`sourceUrlTemplate`) et liste de sources intégrée.
- Hôte et jeton API configurés dans **Onlyturgie — paramètres** (localStorage).

## 2.1.0

- Jeton API hors de `config.json` ; variation modale de paramètres.

## 2.0.1

- Version initiale publique (autocomplétion, panneau PDF/PPT).
