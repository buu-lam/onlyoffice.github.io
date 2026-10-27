# Changelog

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
