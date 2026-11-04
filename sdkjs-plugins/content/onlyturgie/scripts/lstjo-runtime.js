(function (global) {
  "use strict";

  var STORAGE_API_TOKEN_KEY = "onlyturgie.apiToken";
  var STORAGE_API_HOST_KEY = "onlyturgie.apiHost";
  var STORAGE_AUTH_MODE_KEY = "onlyturgie.authMode";
  var STORAGE_URLS_KEY = "jsonAutocomplete.urls";
  var STORAGE_AUTOCOMPLETE_ENABLED_KEY = "onlyturgie.autocompleteEnabled";

  /** @type {Record<string, unknown>} */
  var bridgeOverrides = {};

  var DEFAULT_SOURCE_IDS = [
    "chant",
    "kyrie",
    "gloria",
    "psaume",
    "pu",
    "sanctus",
    "anamnese",
    "np",
    "agnus",
    "diapo",
    "contact",
  ];

  /**
   * Tags de contrôle de contenu → membres du groupe Nextcloud du même nom (GET /api/contacts-{tag}).
   * Prioritaires sur les catalogues homonymes (« pu », « diapo »).
   */
  var GROUP_TAGS = ["animateurs", "musiciens", "lecteurs", "diapo", "pu", "psaume"];
  var GROUP_SOURCE_PREFIX = "groupe:";

  var DEFAULT_SOURCE_URL_TEMPLATE = "{apiBase}/{source}?token={token}";
  var DEFAULT_SOURCE_URL_TEMPLATE_NEXTCLOUD = "{apiBase}/{source}";
  var DEFAULT_API_PATH = "/apps/liturgie/api";
  var AUTH_MODES = ["auto", "token", "nextcloud"];

  /** Préférence toggle autocomplétion panneau — absent = activé (première utilisation). */
  function readAutocompleteEnabledPreference() {
    try {
      var raw = localStorage.getItem(STORAGE_AUTOCOMPLETE_ENABLED_KEY);
      if (raw === null || raw === "") return true;
      var s = String(raw).trim().toLowerCase();
      if (s === "false" || s === "0" || s === "off") return false;
      if (s === "true" || s === "1" || s === "on") return true;
      return true;
    } catch (e) {
      return true;
    }
  }

  function writeAutocompleteEnabledPreference(enabled) {
    try {
      localStorage.setItem(STORAGE_AUTOCOMPLETE_ENABLED_KEY, enabled ? "true" : "false");
    } catch (e2) {
      /* ignore */
    }
  }

  /** Version semver depuis le manifeste ONLYOFFICE (Asc.plugin.info.version). */
  function getPluginVersionString() {
    var p = global.Asc && global.Asc.plugin;
    if (p) {
      if (p.info && p.info.version) return String(p.info.version).trim();
      if (p.version) return String(p.version).trim();
    }
    return "";
  }

  function loadPluginVersionFromConfig(callback) {
    var direct = getPluginVersionString();
    if (direct) {
      callback(direct);
      return;
    }
    fetch("config.json", { method: "GET", cache: "no-store" })
      .then(function (response) {
        if (!response.ok) throw new Error("config");
        return response.json();
      })
      .then(function (json) {
        callback(json && json.version ? String(json.version).trim() : "?");
      })
      .catch(function () {
        callback("?");
      });
  }

  function getLstjoConfig() {
    var p = global.Asc && global.Asc.plugin;
    if (!p) return {};
    if (p.lstjo && typeof p.lstjo === "object") return p.lstjo;
    if (p.variations && p.variations[0] && p.variations[0].lstjo && typeof p.variations[0].lstjo === "object") {
      return p.variations[0].lstjo;
    }
    return {};
  }

  function normalizeAuthMode(mode) {
    var m = String(mode || "").trim().toLowerCase();
    return AUTH_MODES.indexOf(m) !== -1 ? m : "";
  }

  function getStoredAuthMode() {
    try {
      return normalizeAuthMode(localStorage.getItem(STORAGE_AUTH_MODE_KEY) || "");
    } catch (e) {
      return "";
    }
  }

  function setAuthMode(mode) {
    try {
      var m = normalizeAuthMode(mode);
      if (!m) {
        localStorage.removeItem(STORAGE_AUTH_MODE_KEY);
      } else {
        localStorage.setItem(STORAGE_AUTH_MODE_KEY, m);
      }
    } catch (e2) {
      /* ignore */
    }
  }

  function getConfiguredAuthMode(cfg) {
    cfg = cfg || getLstjoConfig();
    var stored = getStoredAuthMode();
    if (stored) return stored;
    if (cfg && typeof cfg.authMode === "string") {
      var fromCfg = normalizeAuthMode(cfg.authMode);
      if (fromCfg) return fromCfg;
    }
    if (bridgeOverrides.authMode) {
      return normalizeAuthMode(bridgeOverrides.authMode);
    }
    return "auto";
  }

  function getEffectiveAuthMode(cfg) {
    cfg = cfg || getLstjoConfig();
    var mode = getConfiguredAuthMode(cfg);
    if (mode === "token" || mode === "nextcloud") return mode;
    if (getApiToken()) return "token";
    if (getResolvedApiHost(cfg)) return "nextcloud";
    return "token";
  }

  function usesTokenInUrls(cfg) {
    return getEffectiveAuthMode(cfg) === "token";
  }

  function setApiHostIfEmpty(host) {
    if (getApiHost()) return;
    setApiHost(host);
  }

  function parseBridgeObject(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    return raw;
  }

  function applyBridgeObject(obj) {
    if (!obj) return;
    if (obj.apiHost) bridgeOverrides.apiHost = obj.apiHost;
    if (obj.authMode) bridgeOverrides.authMode = obj.authMode;
    if (obj.apiBase) bridgeOverrides.apiBase = obj.apiBase;
    if (obj.bridgeToken) bridgeOverrides.bridgeToken = obj.bridgeToken;
    if (obj.lstjo && typeof obj.lstjo === "object") applyBridgeObject(obj.lstjo);
  }

  /** Lit apiHost / authMode injectés par l’intégration (pluginsData, info, config lstjo). */
  function syncFromEditorBridge() {
    var cfg = getLstjoConfig();
    if (cfg.apiHost) setApiHostIfEmpty(cfg.apiHost);
    if (cfg.authMode) {
      var m = normalizeAuthMode(cfg.authMode);
      if (m && !getStoredAuthMode()) bridgeOverrides.authMode = m;
    }
    var p = global.Asc && global.Asc.plugin;
    if (!p) return;
    var info = p.info || {};
    var candidates = [info.onlyturgie, info.lstjo, info.customization && info.customization.onlyturgie];
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (typeof c === "string") {
        try {
          c = JSON.parse(c);
        } catch (e) {
          c = null;
        }
      }
      applyBridgeObject(parseBridgeObject(c));
    }
    if (bridgeOverrides.apiHost) setApiHostIfEmpty(bridgeOverrides.apiHost);
  }

  function getBridgeBearerToken() {
    if (bridgeOverrides.bridgeToken) {
      return String(bridgeOverrides.bridgeToken).trim();
    }
    var cfg = getLstjoConfig();
    if (cfg && typeof cfg.bridgeToken === "string" && cfg.bridgeToken.trim()) {
      return cfg.bridgeToken.trim();
    }
    return "";
  }

  function getFetchCredentials(cfg) {
    return getEffectiveAuthMode(cfg) === "nextcloud" ? "include" : "omit";
  }

  function fetchLiturgie(url, init, cfg) {
    init = init || {};
    cfg = cfg || getLstjoConfig();
    var headers = {};
    if (init.headers && typeof init.headers === "object") {
      Object.keys(init.headers).forEach(function (k) {
        headers[k] = init.headers[k];
      });
    }
    var bearer = getBridgeBearerToken();
    if (bearer && !headers.Authorization && !headers.authorization) {
      headers.Authorization = "Bearer " + bearer;
    }
    return fetch(url, {
      method: init.method || "GET",
      credentials: init.credentials != null ? init.credentials : getFetchCredentials(cfg),
      headers: headers,
      body: init.body,
    });
  }

  function getApiToken() {
    try {
      return (localStorage.getItem(STORAGE_API_TOKEN_KEY) || "").trim();
    } catch (e) {
      return "";
    }
  }

  function setApiToken(token) {
    try {
      localStorage.setItem(STORAGE_API_TOKEN_KEY, String(token || "").trim());
    } catch (e2) {
      /* ignore */
    }
  }

  function normalizeHost(host) {
    var h = String(host || "").trim().replace(/\/+$/, "");
    if (!h) return "";
    if (!/^https?:\/\//i.test(h)) h = "https://" + h;
    return h.replace(/\/+$/, "");
  }

  function getResolvedApiHost(cfg) {
    cfg = cfg || getLstjoConfig();
    try {
      var fromStorage = normalizeHost(localStorage.getItem(STORAGE_API_HOST_KEY) || "");
      if (fromStorage) return fromStorage;
    } catch (e) {
      /* ignore */
    }
    if (bridgeOverrides.apiHost) return normalizeHost(bridgeOverrides.apiHost);
    if (cfg && typeof cfg.apiHost === "string" && cfg.apiHost.trim()) {
      return normalizeHost(cfg.apiHost);
    }
    return "";
  }

  function getApiHost() {
    return getResolvedApiHost();
  }

  function setApiHost(host) {
    try {
      localStorage.setItem(STORAGE_API_HOST_KEY, normalizeHost(host));
    } catch (e2) {
      /* ignore */
    }
  }

  function getApiPath(cfg) {
    cfg = cfg || getLstjoConfig();
    var p =
      cfg && typeof cfg.apiPath === "string" && cfg.apiPath.trim()
        ? cfg.apiPath.trim()
        : DEFAULT_API_PATH;
    if (p.charAt(0) !== "/") p = "/" + p;
    return p.replace(/\/+$/, "");
  }

  function getApiBase(cfg) {
    cfg = cfg || getLstjoConfig();
    var host = getApiHost();
    if (host) return host + getApiPath(cfg);

    if (bridgeOverrides.apiBase) {
      return String(bridgeOverrides.apiBase).trim().replace(/\/+$/, "");
    }
    if (cfg && typeof cfg.apiBase === "string" && cfg.apiBase.trim()) {
      return cfg.apiBase.trim().replace(/\/+$/, "");
    }
    return "";
  }

  function getSourceUrlTemplate(cfg) {
    cfg = cfg || getLstjoConfig();
    if (!usesTokenInUrls(cfg)) {
      if (cfg && typeof cfg.sourceUrlTemplateNextcloud === "string" && cfg.sourceUrlTemplateNextcloud.trim()) {
        return cfg.sourceUrlTemplateNextcloud.trim();
      }
      return DEFAULT_SOURCE_URL_TEMPLATE_NEXTCLOUD;
    }
    if (cfg && typeof cfg.sourceUrlTemplate === "string" && cfg.sourceUrlTemplate.trim()) {
      return cfg.sourceUrlTemplate.trim();
    }
    return DEFAULT_SOURCE_URL_TEMPLATE;
  }

  function getPanelUrlTemplate(cfg, templateKey) {
    cfg = cfg || getLstjoConfig();
    var panel = (cfg && cfg.panel) || {};
    if (!usesTokenInUrls(cfg)) {
      var ncKey = templateKey + "Nextcloud";
      if (typeof panel[ncKey] === "string" && panel[ncKey].trim()) {
        return panel[ncKey].trim();
      }
      if (templateKey === "pdfApiUrlTemplate") return "{apiBase}/pdf?hash={base64url}";
      if (templateKey === "pptApiUrlTemplate") return "{apiBase}/ppt?hash={base64url}";
      if (templateKey === "pptOnlyOfficeConfigUrlTemplate") {
        return "{apiBase}/onlyoffice/panel-config?token={token}&documentUrl={encoded}";
      }
    }
    var tpl = panel[templateKey];
    return typeof tpl === "string" ? tpl.trim() : "";
  }

  function getSourceIds(cfg) {
    cfg = cfg || getLstjoConfig();
    if (cfg && Array.isArray(cfg.sourceIds) && cfg.sourceIds.length) {
      return cfg.sourceIds.map(function (id) {
        return String(id).trim();
      }).filter(Boolean);
    }
    var sources = cfg && cfg.sources;
    if (sources && typeof sources === "object" && !Array.isArray(sources)) {
      return Object.keys(sources);
    }
    if (Array.isArray(sources) && sources.length) {
      return sources.map(function (id) {
        return String(id).trim();
      }).filter(Boolean);
    }
    return DEFAULT_SOURCE_IDS.slice();
  }

  function loadLegacyUrls() {
    try {
      var raw = localStorage.getItem(STORAGE_URLS_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      var out = {};
      Object.keys(parsed).forEach(function (k) {
        if (typeof parsed[k] === "string" && parsed[k].trim()) out[k] = parsed[k].trim();
      });
      return out;
    } catch (e) {
      return {};
    }
  }

  function isAbsoluteUrl(s) {
    return /^https?:\/\//i.test(String(s || "").trim());
  }

  function applyPlaceholders(template, values) {
    var s = String(template || "");
    Object.keys(values).forEach(function (key) {
      var val = values[key] == null ? "" : String(values[key]);
      s = s.split("{" + key + "}").join(val);
    });
    return s.trim();
  }

  function slugifyChantName(s) {
    var t = String(s);
    try {
      t = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    } catch (e) {
      /* ignore */
    }
    return t
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
  }

  /** Base64 standard (UTF-8) — texte brut, pas encodeURIComponent (%20 / %2F interdits avant base64). */
  function base64EncodeUtf8(s) {
    var t = String(s);
    try {
      if (typeof TextEncoder !== "undefined") {
        var bytes = new TextEncoder().encode(t);
        var bin = "";
        for (var i = 0; i < bytes.length; i++) {
          bin += String.fromCharCode(bytes[i]);
        }
        return btoa(bin);
      }
      return btoa(unescape(encodeURIComponent(t)));
    } catch (e) {
      try {
        return base64EncodeUtf8(slugifyChantName(t));
      } catch (e2) {
        return "";
      }
    }
  }

  /** Base64 URL-safe du chemin ou nom de chant (UTF-8 brut, ex. espaces et « / » réels). */
  function base64UrlEncodeChantName(s) {
    var b64 = base64EncodeUtf8(String(s == null ? "" : s).trim());
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  /**
   * Remplace {chant}, {slug}, {encoded}, {base64}, {base64url} pour PDF/PPT.
   * {base64url} = base64 URL-safe du chemin/nom brut (API liturgie hash=), jamais après encodeURIComponent.
   */
  function applyChantUrlPlaceholders(template, chantName) {
    if (!template) return "";
    var trimmed = String(chantName).trim();
    return String(template).replace(/\{(base64url|base64|encoded|slug|chant)\}/g, function (_, key) {
      switch (key) {
        case "base64url":
          return base64UrlEncodeChantName(trimmed);
        case "base64":
          return base64EncodeUtf8(trimmed);
        case "encoded":
          return encodeURIComponent(trimmed);
        case "slug":
          return slugifyChantName(trimmed);
        case "chant":
          return trimmed;
        default:
          return "";
      }
    });
  }

  function resolveSourceSegment(cfg, sourceId) {
    var sources = (cfg && cfg.sources) || {};
    if (sources && typeof sources === "object" && !Array.isArray(sources)) {
      var v = sources[sourceId];
      if (v !== undefined && v !== null && String(v).trim() !== "") {
        return String(v).trim();
      }
    }
    return String(sourceId);
  }

  function extractTokenFromUrl(url) {
    if (!url || typeof url !== "string") return "";
    try {
      return (new URL(url.trim()).searchParams.get("token") || "").trim();
    } catch (e) {
      return "";
    }
  }

  /** Jeton API : localStorage, puis URL catalogue enregistrée (jsonAutocomplete.urls). */
  function getEffectiveApiToken(cfg, sourceId) {
    var direct = getApiToken();
    if (direct) return direct;
    cfg = cfg || getLstjoConfig();
    var sid =
      sourceId ||
      (cfg && cfg.panel && typeof cfg.panel.sourceId === "string" && cfg.panel.sourceId) ||
      "chant";
    var legacy = loadLegacyUrls();
    if (legacy[sid]) {
      var fromLegacy = extractTokenFromUrl(legacy[sid]);
      if (fromLegacy) return fromLegacy;
    }
    var built = buildSourceUrlFromTemplate(cfg, sid);
    if (built) {
      var fromBuilt = extractTokenFromUrl(built);
      if (fromBuilt) return fromBuilt;
    }
    return "";
  }

  function buildSourceUrlFromTemplate(cfg, sourceId) {
    cfg = cfg || getLstjoConfig();
    var token = getApiToken();
    var tokenMode = usesTokenInUrls(cfg);
    if (tokenMode && !token) return "";

    var apiBase = getApiBase(cfg);
    if (!apiBase) return "";

    var segment = resolveSourceSegment(cfg, sourceId);
    if (isAbsoluteUrl(segment)) {
      try {
        var u = new URL(segment);
        if (tokenMode && token) u.searchParams.set("token", token);
        return u.toString();
      } catch (e) {
        return "";
      }
    }

    var host = getApiHost() || apiBase;
    var resolved = applyPlaceholders(getSourceUrlTemplate(cfg), {
      host: host,
      apiBase: apiBase,
      apiPath: getApiPath(cfg),
      source: segment.replace(/^\//, ""),
      token: token,
    });

    if (/\{[a-zA-Z0-9]+\}/.test(resolved)) return "";
    return resolved;
  }

  /** URL effective pour une source (legacy storage > modèle + hôte + jeton). */
  function resolveSourceUrl(sourceId, cfg) {
    cfg = cfg || getLstjoConfig();
    var legacy = loadLegacyUrls();
    if (legacy[sourceId]) return legacy[sourceId];
    return buildSourceUrlFromTemplate(cfg, sourceId);
  }

  function resolveAllSourceUrls(cfg) {
    cfg = cfg || getLstjoConfig();
    var out = {};
    getSourceIds(cfg).forEach(function (k) {
      out[k] = resolveSourceUrl(k, cfg);
    });
    GROUP_TAGS.forEach(function (g) {
      out[GROUP_SOURCE_PREFIX + g] = buildSourceUrlFromTemplate(cfg, "contacts-" + g);
    });
    return out;
  }

  function resolvePanelApiTemplate(cfg, templateKey) {
    cfg = cfg || getLstjoConfig();
    var tpl = getPanelUrlTemplate(cfg, templateKey);
    if (!tpl) return "";

    var sourceId =
      (cfg && cfg.panel && typeof cfg.panel.sourceId === "string" && cfg.panel.sourceId) || "chant";
    var token = getEffectiveApiToken(cfg, sourceId);
    var apiBase = getApiBase(cfg);
    if (!apiBase) return "";
    var host = getApiHost() || apiBase;
    var resolved = applyPlaceholders(tpl, {
      host: host,
      apiBase: apiBase,
      apiPath: getApiPath(cfg),
      token: token,
    });

    if (templateHasUnresolvedConfigPlaceholders(resolved)) return "";
    if (usesTokenInUrls(cfg) && resolved.indexOf("token=") !== -1 && !token) return "";
    return resolved;
  }

  /** Placeholders chant ({base64url}, etc.) restent pour applyChantUrlPlaceholders dans le panneau. */
  function templateHasUnresolvedConfigPlaceholders(resolved) {
    var re = /\{([a-zA-Z0-9]+)\}/g;
    var allowedChant = {
      base64url: true,
      base64: true,
      encoded: true,
      slug: true,
      chant: true,
    };
    var m;
    while ((m = re.exec(resolved)) !== null) {
      if (!allowedChant[m[1]]) return true;
    }
    return false;
  }

  /**
   * Modèle optionnel GET …/api/pdf/files ou …/api/ppt/files (évolution liturgie-nc ; …/list conservé côté serveur).
   * Dérivé du modèle pdf/ppt si pdfListApiUrlTemplate absent.
   */
  function resolvePanelListApiTemplate(cfg, kind) {
    cfg = cfg || getLstjoConfig();
    var listKey = kind === "pdf" ? "pdfListApiUrlTemplate" : "pptListApiUrlTemplate";
    var tpl = getPanelUrlTemplate(cfg, listKey);
    if (tpl) {
      var resolvedList = resolvePanelApiTemplate(cfg, listKey);
      if (resolvedList) return resolvedList;
    }
    var metaKey = kind === "pdf" ? "pdfApiUrlTemplate" : "pptApiUrlTemplate";
    var base = resolvePanelApiTemplate(cfg, metaKey);
    if (!base) return "";
    return base.replace(/\/api\/(pdf|ppt)(\?|$)/i, "/api/$1/all$2");
  }

  function inferPanelApiUrlTemplateFromCatalogUrl(catalogUrl, targetKind, cfg) {
    if (!catalogUrl || typeof catalogUrl !== "string") return "";
    var trimmed = catalogUrl.trim();
    if (!trimmed) return "";

    var u;
    try {
      u = new URL(trimmed);
    } catch (e) {
      return "";
    }

    var token = "";
    try {
      token = u.searchParams.get("token") || "";
    } catch (e2) {
      token = "";
    }

    var pathname = u.pathname || "";
    var newPath = pathname.replace(/\/api\/[^/]+$/i, "/api/" + targetKind);
    if (newPath === pathname) return "";

    if (token) {
      return u.origin + newPath + "?token=" + encodeURIComponent(token) + "&hash={base64url}";
    }
    if (getEffectiveAuthMode(cfg) === "nextcloud") {
      return u.origin + newPath + "?hash={base64url}";
    }
    return "";
  }

  function hasApiCredentials(cfg) {
    cfg = cfg || getLstjoConfig();
    if (getEffectiveAuthMode(cfg) === "nextcloud") {
      return !!getApiBase(cfg);
    }
    if (getEffectiveApiToken(cfg)) return !!getApiBase(cfg) || !!extractTokenFromUrl(resolveSourceUrl("chant", cfg));
    if (!getApiBase(cfg)) {
      var legacy = loadLegacyUrls();
      return Object.keys(legacy).some(function (k) {
        return !!extractTokenFromUrl(legacy[k]);
      });
    }
    return false;
  }

  function getCredentialsStatusMessage(cfg) {
    cfg = cfg || getLstjoConfig();
    if (hasApiCredentials(cfg)) return "";
    if (getEffectiveAuthMode(cfg) === "nextcloud") {
      return "Ouvrez « Onlyturgie — paramètres » et renseignez l’hôte Nextcloud (mode session).";
    }
    return "Ouvrez « Onlyturgie — paramètres » et renseignez l’hôte et le jeton API.";
  }

  function countCatalogPayload(payload) {
    if (Array.isArray(payload)) return payload.length;
    if (payload && Array.isArray(payload.items)) return payload.items.length;
    if (payload && Array.isArray(payload.data)) return payload.data.length;
    return 0;
  }

  /** Diagnostic : GET catalogue (défaut chant) depuis l’iframe plugin (origine du plugin, pas Nextcloud). */
  function testCatalogSource(sourceId, cfg) {
    cfg = cfg || getLstjoConfig();
    sourceId = sourceId || "chant";
    var mode = getEffectiveAuthMode(cfg);
    var apiBase = getApiBase(cfg);
    var url = resolveSourceUrl(sourceId, cfg);
    if (!url) {
      return Promise.resolve({
        ok: false,
        sourceId: sourceId,
        mode: mode,
        apiBase: apiBase,
        url: "",
        error: getCredentialsStatusMessage(cfg) || "URL du catalogue vide (hôte, jeton ou mode).",
      });
    }
    return fetchLiturgie(url, {}, cfg)
      .then(function (response) {
        return response.text().then(function (text) {
          var preview = text.length > 200 ? text.slice(0, 200) + "…" : text;
          if (!response.ok) {
            return {
              ok: false,
              sourceId: sourceId,
              mode: mode,
              apiBase: apiBase,
              url: url,
              status: response.status,
              error: preview,
            };
          }
          var payload;
          try {
            payload = JSON.parse(text);
          } catch (parseErr) {
            return {
              ok: false,
              sourceId: sourceId,
              mode: mode,
              apiBase: apiBase,
              url: url,
              status: response.status,
              error: "Réponse non JSON : " + preview,
            };
          }
          var count = countCatalogPayload(payload);
          return {
            ok: true,
            sourceId: sourceId,
            mode: mode,
            apiBase: apiBase,
            url: url,
            status: response.status,
            count: count,
            preview: preview,
          };
        });
      })
      .catch(function (err) {
        return {
          ok: false,
          sourceId: sourceId,
          mode: mode,
          apiBase: apiBase,
          url: url,
          error: String(err && err.message ? err.message : err),
        };
      });
  }

  var settingsPluginWindow = null;
  var settingsWindowOnCloseHook = null;

  function buildSettingsWindowVariation() {
    return {
      url: resolvePluginFileUrl("settings.html"),
      description: "Jeton API liturgie (stockage local)",
      descriptionLocale: {
        fr: "Saisie du jeton API ; hôte et mode d’auth (localStorage).",
      },
      type: "window",
      isVisual: true,
      isViewer: true,
      initDataType: "none",
      isUpdateOleOnResize: false,
      EditorsSupport: ["word", "cell", "slide"],
      buttons: [
        {
          text: "OK",
          primary: true,
          textLocale: {
            fr: "OK",
          },
        },
      ],
      size: [440, 448],
    };
  }

  function finishSettingsWindowClosed() {
    syncFromEditorBridge();
    var hook = settingsWindowOnCloseHook;
    settingsWindowOnCloseHook = null;
    if (typeof hook === "function") {
      try {
        hook();
      } catch (e) {
        /* ignore */
      }
    }
    resetPanelAutoOpenForDocument();
    showOnlyturgiePanel();
  }

  /**
   * Ouvre settings.html en modale (PluginWindow) sans remplacer le panneau droit.
   * Si PluginWindow indisponible (iframe panneau), délègue au background via sendToPlugin.
   */
  function openOnlyturgieSettingsWindow(opts) {
    opts = opts || {};
    settingsWindowOnCloseHook = typeof opts.onClose === "function" ? opts.onClose : null;

    // Dans une fenêtre enfant (panneau ouvert par le background), PluginWindow existe aussi mais ses
    // appels ne seraient pas relayés : seul le background peut ouvrir et piloter la fenêtre Paramètres.
    var isChildWindow = !!(global.Asc && global.Asc.plugin && global.Asc.plugin.windowID);
    if (!isChildWindow && global.Asc && global.Asc.PluginWindow) {
      if (!settingsPluginWindow) {
        settingsPluginWindow = new global.Asc.PluginWindow();
        settingsPluginWindow.attachEvent("onClose", function () {
          finishSettingsWindowClosed();
        });
      }
      settingsPluginWindow.show(buildSettingsWindowVariation());
      return true;
    }

    try {
      if (global.Asc && global.Asc.plugin && typeof global.Asc.plugin.sendToPlugin === "function") {
        global.Asc.plugin.sendToPlugin("onlyturgie.openSettings", { at: Date.now() });
        return true;
      }
    } catch (e2) {
      /* ignore */
    }
    return false;
  }

  function getPanelVariationMeta() {
    var p = global.Asc && global.Asc.plugin;
    if (!p || !p.variations || !p.variations.length) return null;
    for (var i = 0; i < p.variations.length; i++) {
      if (p.variations[i] && p.variations[i].type === "panelRight") {
        return p.variations[i];
      }
    }
    return p.variations[0];
  }

  /**
   * Fenêtre panneau ouverte depuis le background. Passer par Asc.PluginWindow (et non ShowWindow brut) :
   * - id alphanumérique (l’éditeur en fait un sélecteur jQuery `#panel-plugins-<id>` : pas de `.{}`) ;
   * - `?windowID=<id>` ajouté à l’URL → l’éditeur envoie `init` au panneau ;
   * - fenêtre enregistrée dans Asc.plugin._windows → ses executeMethod / callCommand (relayés par le
   *   background) reçoivent une réponse. Sans cela le panneau reste figé sur « Chargement… ».
   */
  var panelPluginWindow = null;

  function getPanelPluginWindow() {
    if (panelPluginWindow) return panelPluginWindow;
    if (!global.Asc || !global.Asc.PluginWindow) return null;
    if (global.Asc.plugin && global.Asc.plugin.windowID) return null; // déjà dans une fenêtre enfant
    panelPluginWindow = new global.Asc.PluginWindow();
    return panelPluginWindow;
  }

  /** Relaye un événement éditeur (reçu par le background) au panneau : arrive en `event_<name>`. */
  function forwardEventToPanelWindow(name, data) {
    if (!panelPluginWindow) return false;
    try {
      panelPluginWindow.command(name, data === undefined ? {} : data);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * ShowWindow : l’éditeur passe `variation.url` tel quel à l’iframe, résolu depuis la page éditeur
   * (web-apps/apps/documenteditor/main/) → 404. On construit l’URL absolue depuis le dossier du plugin.
   */
  function resolvePluginFileUrl(relativePath) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(relativePath)) return relativePath;
    try {
      return new URL(relativePath, global.location.href).href;
    } catch (e) {
      return relativePath;
    }
  }

  function buildPanelShowWindowVariation(opts) {
    opts = opts || {};
    var cfg = getLstjoConfig();
    var panel = (cfg && cfg.panel) || {};
    var meta = getPanelVariationMeta() || {};
    var w =
      typeof panel.panelWidth === "number" && panel.panelWidth > 0 ? panel.panelWidth : 520;
    var h =
      typeof panel.panelHeight === "number" && panel.panelHeight > 0 ? panel.panelHeight : 720;
    var isActivated = opts.isActivated;
    if (typeof isActivated !== "boolean") {
      isActivated = panel.autoOpenCollapsed === true ? false : true;
    }
    var variation = {
      url: resolvePluginFileUrl(meta.url || "panel.html"),
      description: meta.description || "Panneau latéral : PDF et présentation",
      descriptionLocale: meta.descriptionLocale || {
        fr: "Panneau droit : aperçu PDF (haut) et présentation (bas), URLs dans lstjo.panel.",
      },
      type: "panelRight",
      isVisual: true,
      isActivated: isActivated,
      initDataType: "none",
      EditorsSupport: meta.EditorsSupport || ["word", "cell", "slide"],
      events: meta.events || ["onTargetPositionChanged"],
      size: [w, h],
    };
    if (meta.name) variation.name = meta.name;
    if (meta.nameLocale) variation.nameLocale = meta.nameLocale;
    if (meta.icons) variation.icons = meta.icons;
    if (meta.icons2) variation.icons2 = meta.icons2;
    return variation;
  }

  function panelShowWindow(isActivated) {
    var p = global.Asc && global.Asc.plugin;
    if (!p || typeof p.executeMethod !== "function") return false;
    var editor = p.info && p.info.editorType;
    if (editor && ["word", "cell", "slide"].indexOf(editor) === -1) return false;
    var win = getPanelPluginWindow();
    if (!win) return false;
    win.show(buildPanelShowWindowVariation({ isActivated: isActivated }));
    return true;
  }

  /** Accroche l’icône panneau à la nav droite sans l’ouvrir (ONLYOFFICE 8.3+ : isActivated false). */
  function registerOnlyturgiePanelRightNav() {
    return panelShowWindow(false);
  }

  function isPanelAutoOpenOnDocument() {
    var cfg = getLstjoConfig();
    var panel = (cfg && cfg.panel) || {};
    return panel.autoOpenOnDocument !== false;
  }

  function resetPanelAutoOpenForDocument() {
    global.lstjoPanelAutoOpenDone = false;
  }

  /**
   * Ouvre le panneau droit. ShowWindow avec type panelRight enregistre l’icône sur la nav droite
   * (ne pas utiliser isInsideMode : il intègre le plugin dans le panneau éditeur sans bouton toolbar).
   */
  function showOnlyturgiePanel() {
    var cfg = getLstjoConfig();
    var panel = (cfg && cfg.panel) || {};
    if (panel.autoOpenCollapsed === true) return registerOnlyturgiePanelRightNav();
    return panelShowWindow(true);
  }

  /** Ouverture auto dès l’activation du plugin (indépendant de autoOpenOnDocument). */
  function ensureOnlyturgiePanelOnPluginActivation() {
    showOnlyturgiePanel();
  }

  /**
   * ShowWindow peut échouer si l’éditeur n’est pas prêt au premier init background :
   * quelques tentatives espacées enregistrent l’icône panelRight sans isInsideMode.
   */
  function scheduleEnsureOnlyturgiePanelOnPluginActivation() {
    var delays = [0, 600, 1800];
    for (var i = 0; i < delays.length; i++) {
      (function (delayMs) {
        if (typeof global.setTimeout === "function") {
          global.setTimeout(function () {
            ensureOnlyturgiePanelOnPluginActivation();
          }, delayMs);
        } else if (delayMs === 0) {
          ensureOnlyturgiePanelOnPluginActivation();
        }
      })(delays[i]);
    }
  }

  function ensureOnlyturgiePanelOnDocument() {
    if (!isPanelAutoOpenOnDocument()) return;
    if (global.lstjoPanelAutoOpenDone) return;
    global.lstjoPanelAutoOpenDone = true;
    showOnlyturgiePanel();
  }

  function scheduleRegisterOnlyturgiePanelRightNav() {
    var run = function () {
      registerOnlyturgiePanelRightNav();
    };
    if (typeof global.setTimeout === "function") {
      global.setTimeout(run, 400);
    } else {
      run();
    }
  }

  function scheduleEnsureOnlyturgiePanelOnDocument() {
    if (!isPanelAutoOpenOnDocument()) return;
    var run = function () {
      ensureOnlyturgiePanelOnDocument();
    };
    if (typeof global.setTimeout === "function") {
      global.setTimeout(run, 0);
    } else {
      run();
    }
  }

  /** @deprecated alias — ouverture au chargement document uniquement */
  function ensureOnlyturgiePanelVisible() {
    ensureOnlyturgiePanelOnDocument();
  }

  /** @deprecated alias */
  function scheduleEnsureOnlyturgiePanelVisible() {
    scheduleEnsureOnlyturgiePanelOnDocument();
  }

  /** Après OK paramètres : notifier le background (localStorage est par origine du plugin, pas Nextcloud). */
  function notifySettingsSaved() {
    var guid = global.Asc && global.Asc.plugin && global.Asc.plugin.guid;
    try {
      if (global.Asc && global.Asc.plugin && typeof global.Asc.plugin.sendToPlugin === "function") {
        global.Asc.plugin.sendToPlugin("onlyturgie.settingsSaved", { at: Date.now() });
      }
    } catch (e) {
      /* ignore */
    }
    try {
      if (global.parent && global.parent !== global) {
        global.parent.postMessage(
          JSON.stringify({ type: "onlyturgie.settingsSaved", guid: guid, at: Date.now() }),
          "*"
        );
      }
    } catch (e2) {
      /* ignore */
    }
  }

  /**
   * Texte du document ouvert (paragraphes, tableaux, contrôles de contenu), une ligne par paragraphe,
   * plus l’identité du document (clé ONLYOFFICE, URL de suivi) pour les actions côté Nextcloud.
   * callback({ lines: string[], key: string, callbackUrl: string, title: string })
   */
  function collectDocumentSnapshot(callback) {
    var info = (global.Asc && global.Asc.plugin && global.Asc.plugin.info) || {};
    var meta = {
      key: String(info.documentId || ""),
      callbackUrl: String(info.documentCallbackUrl || ""),
      title: String(info.documentTitle || ""),
    };
    function done(text) {
      meta.lines = String(text || "")
        .split(/\r?\n/)
        .map(function (l) {
          return l.trim();
        })
        .filter(Boolean);
      callback(meta);
    }
    if (!global.Asc || !global.Asc.plugin || typeof global.Asc.plugin.callCommand !== "function") {
      done("");
      return;
    }
    global.Asc.plugin.callCommand(
      function () {
        var out = [];
        function walk(content, depth) {
          if (!content || typeof content.GetElementsCount !== "function" || depth > 8) return;
          var n = content.GetElementsCount();
          for (var i = 0; i < n; i++) {
            var el = content.GetElement(i);
            if (!el || typeof el.GetClassType !== "function") continue;
            var t = el.GetClassType();
            if (t === "paragraph") {
              out.push(el.GetText());
            } else if (t === "table") {
              for (var r = 0; r < el.GetRowsCount(); r++) {
                var row = el.GetRow(r);
                for (var c = 0; c < row.GetCellsCount(); c++) {
                  walk(row.GetCell(c).GetContent(), depth + 1);
                }
              }
            } else if (t === "blockLvlSdt") {
              walk(el.GetContent(), depth + 1);
            }
          }
        }
        walk(Api.GetDocument(), 0);
        return out.join("\n");
      },
      false,
      false,
      function (result) {
        done(result);
      }
    );
  }

  /** Libellé de la cellule de gauche qui signale une diapo directe (« Diapo », « Diapos », « diapo : … »). */
  function isDiapoCellLabel(text) {
    return /^\s*diapos?(?![a-zÀ-ɏ])/i.test(String(text || ""));
  }

  /**
   * Paragraphe sous le curseur et texte de la cellule à sa gauche (même ligne de tableau).
   * callback({ text, left }) — chaînes vides hors tableau ou hors éditeur texte.
   */
  function readCursorCellContext(callback) {
    var p = global.Asc && global.Asc.plugin;
    var et = p && p.info && p.info.editorType;
    if (p && typeof p.callCommand === "function" && et === "cell") {
      readSheetCellContext(callback);
      return;
    }
    if (!p || typeof p.callCommand !== "function" || (et && et !== "word")) {
      callback({ text: "", left: "" });
      return;
    }
    p.callCommand(
      function () {
        try {
          var para = Api.GetDocument().GetCurrentParagraph();
          if (!para) return "";
          var out = { text: para.GetText() || "", left: "" };
          var cell = typeof para.GetParentTableCell === "function" ? para.GetParentTableCell() : null;
          if (cell && typeof cell.GetIndex === "function" && typeof cell.GetParentRow === "function") {
            var idx = cell.GetIndex();
            var prev = idx > 0 ? cell.GetParentRow().GetCell(idx - 1) : null;
            if (prev) {
              var content = prev.GetContent();
              var n = content.GetElementsCount();
              var parts = [];
              for (var i = 0; i < n; i++) {
                var el = content.GetElement(i);
                if (el && typeof el.GetText === "function") parts.push(el.GetText());
              }
              out.left = parts.join(" ");
            }
          }
          return JSON.stringify(out);
        } catch (e) {
          return "";
        }
      },
      false,
      false,
      function (raw) {
        var ctx = { text: "", left: "" };
        try {
          if (raw) {
            var j = JSON.parse(raw);
            ctx.text = String(j.text || "");
            ctx.left = String(j.left || "");
          }
        } catch (e2) {
          /* ignore */
        }
        callback(ctx);
      }
    );
  }

  /**
   * Tableur : en-tête de colonne (ligne 1) et cellule de gauche de la cellule active.
   * callback({ text, left, header }) — text est vide (la cellule est en cours de saisie).
   */
  function readSheetCellContext(callback) {
    var p = global.Asc.plugin;
    p.callCommand(
      function () {
        try {
          var sheet = Api.GetActiveSheet();
          var cell = sheet && sheet.GetActiveCell();
          if (!cell) return "";
          var row = cell.GetRow(); // 1-based
          var col = cell.GetCol(); // 1-based
          var val = function (r, c) {
            if (r < 0 || c < 0) return "";
            var v = sheet.GetRangeByNumber(r, c).GetValue();
            return v == null ? "" : String(v);
          };
          return JSON.stringify({
            header: row > 1 ? val(0, col - 1) : "",
            left: val(row - 1, col - 2)
          });
        } catch (e) {
          return "";
        }
      },
      false,
      false,
      function (raw) {
        var ctx = { text: "", left: "", header: "" };
        try {
          if (raw) {
            var j = JSON.parse(raw);
            ctx.left = String(j.left || "");
            ctx.header = String(j.header || "");
          }
        } catch (e2) {
          /* ignore */
        }
        callback(ctx);
      }
    );
  }

  /** Ajoute scope=diapo à un modèle d’URL API (fichier cherché dans le dossier diapos). */
  function withDiapoScope(url) {
    var s = String(url || "");
    if (!s || /[?&]scope=/.test(s)) return s;
    return s + (s.indexOf("?") === -1 ? "?" : "&") + "scope=diapo";
  }

  var STORAGE_DOC_CONTEXT_KEY = "onlyturgie.docContext";

  /**
   * Clé ONLYOFFICE + URL de suivi du document ouvert (l’API liturgie en déduit le docx et son dossier « Diapos »).
   * Le background a Asc.plugin.info ; il les publie dans localStorage pour le panneau (fenêtre enfant).
   */
  function getDocumentContext() {
    var info = (global.Asc && global.Asc.plugin && global.Asc.plugin.info) || {};
    var ctx = { key: String(info.documentId || ""), callbackUrl: String(info.documentCallbackUrl || "") };
    if (ctx.key || ctx.callbackUrl) {
      try {
        localStorage.setItem(STORAGE_DOC_CONTEXT_KEY, JSON.stringify(ctx));
      } catch (e) {
        /* ignore */
      }
      return ctx;
    }
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_DOC_CONTEXT_KEY) || "null");
      if (saved && typeof saved === "object") {
        return { key: String(saved.key || ""), callbackUrl: String(saved.callbackUrl || "") };
      }
    } catch (e2) {
      /* ignore */
    }
    return ctx;
  }

  /** Ajoute key / callbackUrl du document ouvert à une URL API. */
  function withDocumentContext(url) {
    var s = String(url || "");
    if (!s) return s;
    var ctx = getDocumentContext();
    var parts = [];
    if (ctx.key && !/[?&]key=/.test(s)) parts.push("key=" + encodeURIComponent(ctx.key));
    if (ctx.callbackUrl && !/[?&]callbackUrl=/.test(s)) parts.push("callbackUrl=" + encodeURIComponent(ctx.callbackUrl));
    if (!parts.length) return s;
    return s + (s.indexOf("?") === -1 ? "?" : "&") + parts.join("&");
  }

  var STORAGE_CURSOR_CELL_KEY = "onlyturgie.cursorCell";

  /**
   * Le panneau lit déjà la cellule sous le curseur (~0,4 s) : il publie « diapo ou non » pour que
   * l’autocomplétion n’ajoute pas un callCommand par frappe (appels concurrents avec le relais du panneau).
   */
  function publishCursorCellHint(isDiapo) {
    try {
      localStorage.setItem(STORAGE_CURSOR_CELL_KEY, JSON.stringify({ at: Date.now(), diapo: !!isDiapo }));
    } catch (e) {
      /* ignore */
    }
  }

  /** Dernier indice publié par le panneau, ou null s’il est plus vieux que maxAgeMs (panneau fermé). */
  function readCursorCellHint(maxAgeMs) {
    try {
      var h = JSON.parse(localStorage.getItem(STORAGE_CURSOR_CELL_KEY) || "null");
      if (h && typeof h.at === "number" && Date.now() - h.at <= (maxAgeMs || 3000)) {
        return { diapo: !!h.diapo };
      }
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  /**
   * Configuration en un clic : le bookmarklet (exécuté sur la page Nextcloud) envoie
   * { type: "onlyturgie:setup", apiHost, token } à toutes les frames. On n’accepte que si
   * apiHost a la même origine que l’expéditeur (garantie par le navigateur).
   */
  function onSetupMessage(ev) {
    var d = ev && ev.data;
    if (!d || typeof d !== "object") return;
    if (d.type === "onlyturgie:reset") {
      // Remise à zéro pour test de bout en bout : seulement depuis l'hôte API enregistré (ou si aucun).
      var cur = getApiHost();
      var allowed = true;
      try {
        allowed = !cur || new URL(cur).origin === ev.origin;
      } catch (eR) {
        allowed = false;
      }
      if (allowed) {
        try {
          [STORAGE_API_TOKEN_KEY, STORAGE_API_HOST_KEY, STORAGE_AUTH_MODE_KEY, STORAGE_URLS_KEY].forEach(function (k) {
            localStorage.removeItem(k);
          });
        } catch (eR2) {
          /* ignore */
        }
      }
      try {
        if (ev.source) ev.source.postMessage({ type: "onlyturgie:reset-ack", ok: allowed }, ev.origin);
      } catch (eR3) {
        /* ignore */
      }
      return;
    }
    if (d.type !== "onlyturgie:setup") return;
    var host = normalizeHost(d.apiHost);
    var token = String(d.token || "").trim();
    var ok = false;
    try {
      ok = !!host && !!token && new URL(host).origin === ev.origin;
    } catch (e) {
      ok = false;
    }
    if (ok) {
      setApiHost(host);
      setApiToken(token);
      setAuthMode("token");
      try {
        localStorage.removeItem(STORAGE_URLS_KEY);
      } catch (e2) {
        /* ignore */
      }
    }
    try {
      if (ev.source) ev.source.postMessage({ type: "onlyturgie:setup-ack", ok: ok }, ev.origin);
    } catch (e3) {
      /* ignore */
    }
  }
  try {
    global.addEventListener("message", onSetupMessage);
  } catch (e4) {
    /* ignore */
  }

  /**
   * Base du Document Server qui exécute le plugin, déduite de l'URL de l'éditeur (referrer) :
   * « https://ds.exemple/9.4.0-abc/web-apps/apps/… » → « https://ds.exemple/9.4.0-abc/ ».
   * Évite toute URL de Document Server codée en dur dans config.json.
   */
  function getEditorDocumentServerOrigin() {
    var ref = "";
    try {
      ref = String(global.document && global.document.referrer || "");
    } catch (e) {
      ref = "";
    }
    if (!ref) return "";
    var i = ref.indexOf("/web-apps/");
    if (i > 0) return ref.slice(0, i + 1);
    try {
      return new URL(ref).origin + "/";
    } catch (e2) {
      return "";
    }
  }

  global.LstjoRuntime = {
    getEditorDocumentServerOrigin: getEditorDocumentServerOrigin,
    publishCursorCellHint: publishCursorCellHint,
    readCursorCellHint: readCursorCellHint,
    getDocumentContext: getDocumentContext,
    withDocumentContext: withDocumentContext,
    isDiapoCellLabel: isDiapoCellLabel,
    readCursorCellContext: readCursorCellContext,
    withDiapoScope: withDiapoScope,
    collectDocumentSnapshot: collectDocumentSnapshot,
    STORAGE_API_TOKEN_KEY: STORAGE_API_TOKEN_KEY,
    STORAGE_API_HOST_KEY: STORAGE_API_HOST_KEY,
    STORAGE_AUTH_MODE_KEY: STORAGE_AUTH_MODE_KEY,
    STORAGE_URLS_KEY: STORAGE_URLS_KEY,
    STORAGE_AUTOCOMPLETE_ENABLED_KEY: STORAGE_AUTOCOMPLETE_ENABLED_KEY,
    DEFAULT_SOURCE_IDS: DEFAULT_SOURCE_IDS,
    GROUP_TAGS: GROUP_TAGS,
    GROUP_SOURCE_PREFIX: GROUP_SOURCE_PREFIX,
    AUTH_MODES: AUTH_MODES,
    getLstjoConfig: getLstjoConfig,
    syncFromEditorBridge: syncFromEditorBridge,
    getApiToken: getApiToken,
    getEffectiveApiToken: getEffectiveApiToken,
    extractTokenFromUrl: extractTokenFromUrl,
    setApiToken: setApiToken,
    getAuthMode: getConfiguredAuthMode,
    setAuthMode: setAuthMode,
    getEffectiveAuthMode: getEffectiveAuthMode,
    getApiHost: getApiHost,
    setApiHost: setApiHost,
    setApiHostIfEmpty: setApiHostIfEmpty,
    getApiPath: getApiPath,
    getApiBase: getApiBase,
    getSourceIds: getSourceIds,
    getSourceUrlTemplate: getSourceUrlTemplate,
    loadLegacyUrls: loadLegacyUrls,
    resolveSourceUrl: resolveSourceUrl,
    resolveAllSourceUrls: resolveAllSourceUrls,
    resolvePanelApiTemplate: resolvePanelApiTemplate,
    resolvePanelListApiTemplate: resolvePanelListApiTemplate,
    applyChantUrlPlaceholders: applyChantUrlPlaceholders,
    readAutocompleteEnabledPreference: readAutocompleteEnabledPreference,
    writeAutocompleteEnabledPreference: writeAutocompleteEnabledPreference,
    getPluginVersionString: getPluginVersionString,
    loadPluginVersionFromConfig: loadPluginVersionFromConfig,
    showOnlyturgiePanel: showOnlyturgiePanel,
    registerOnlyturgiePanelRightNav: registerOnlyturgiePanelRightNav,
    scheduleRegisterOnlyturgiePanelRightNav: scheduleRegisterOnlyturgiePanelRightNav,
    buildPanelShowWindowVariation: buildPanelShowWindowVariation,
    isPanelAutoOpenOnDocument: isPanelAutoOpenOnDocument,
    ensureOnlyturgiePanelOnPluginActivation: ensureOnlyturgiePanelOnPluginActivation,
    ensureOnlyturgiePanelOnDocument: ensureOnlyturgiePanelOnDocument,
    scheduleEnsureOnlyturgiePanelOnPluginActivation: scheduleEnsureOnlyturgiePanelOnPluginActivation,
    scheduleEnsureOnlyturgiePanelOnDocument: scheduleEnsureOnlyturgiePanelOnDocument,
    base64UrlEncodeChantName: base64UrlEncodeChantName,
    inferPanelApiUrlTemplateFromCatalogUrl: inferPanelApiUrlTemplateFromCatalogUrl,
    hasApiCredentials: hasApiCredentials,
    getCredentialsStatusMessage: getCredentialsStatusMessage,
    fetchLiturgie: fetchLiturgie,
    getFetchCredentials: getFetchCredentials,
    testCatalogSource: testCatalogSource,
    notifySettingsSaved: notifySettingsSaved,
    openOnlyturgieSettingsWindow: openOnlyturgieSettingsWindow,
    forwardEventToPanelWindow: forwardEventToPanelWindow,
    buildSettingsWindowVariation: buildSettingsWindowVariation,
    resetPanelAutoOpenForDocument: resetPanelAutoOpenForDocument,
    scheduleEnsureOnlyturgiePanelVisible: scheduleEnsureOnlyturgiePanelVisible,
  };
})(typeof window !== "undefined" ? window : this);
