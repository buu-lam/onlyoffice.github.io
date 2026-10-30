(function (global) {
  "use strict";

  var STORAGE_API_TOKEN_KEY = "onlyturgie.apiToken";
  var STORAGE_API_HOST_KEY = "onlyturgie.apiHost";
  var STORAGE_AUTH_MODE_KEY = "onlyturgie.authMode";
  var STORAGE_URLS_KEY = "jsonAutocomplete.urls";

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

  var DEFAULT_SOURCE_URL_TEMPLATE = "{apiBase}/{source}?token={token}";
  var DEFAULT_SOURCE_URL_TEMPLATE_NEXTCLOUD = "{apiBase}/{source}";
  var DEFAULT_API_PATH = "/apps/liturgie/api";
  var AUTH_MODES = ["auto", "token", "nextcloud"];

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

  function buildPanelShowWindowVariation() {
    var cfg = getLstjoConfig();
    var panel = (cfg && cfg.panel) || {};
    var w =
      typeof panel.panelWidth === "number" && panel.panelWidth > 0 ? panel.panelWidth : 520;
    var h =
      typeof panel.panelHeight === "number" && panel.panelHeight > 0 ? panel.panelHeight : 720;
    return {
      url: "panel.html",
      description: "Panneau latéral : PDF et présentation",
      descriptionLocale: {
        fr: "Panneau droit : aperçu PDF (haut) et présentation (bas), URLs dans lstjo.panel.",
      },
      type: "panelRight",
      isVisual: true,
      isActivated: panel.autoOpenCollapsed === true ? false : true,
      initDataType: "none",
      EditorsSupport: ["word", "cell", "slide"],
      events: ["onTargetPositionChanged"],
      size: [w, h],
    };
  }

  function isPanelAutoOpenEnabled() {
    var cfg = getLstjoConfig();
    var panel = (cfg && cfg.panel) || {};
    return panel.autoOpenOnDocument !== false;
  }

  function resetPanelAutoOpenForDocument() {
    global.lstjoPanelAutoOpenDone = false;
  }

  /**
   * Affiche la variation panneau (icône barre droite + panneau) sans passer par le menu Compléments.
   * Nécessite que la variation background Onlyturgie soit active (état mémorisé par l’éditeur).
   */
  function ensureOnlyturgiePanelVisible() {
    if (!isPanelAutoOpenEnabled()) return;
    if (global.lstjoPanelAutoOpenDone) return;
    var p = global.Asc && global.Asc.plugin;
    if (!p || typeof p.executeMethod !== "function") return;
    var guid = p.guid;
    if (!guid || typeof guid !== "string") return;
    var editor = p.info && p.info.editorType;
    if (editor && ["word", "cell", "slide"].indexOf(editor) === -1) return;
    global.lstjoPanelAutoOpenDone = true;
    p.executeMethod("ShowWindow", ["iframe_" + guid, buildPanelShowWindowVariation()]);
  }

  function scheduleEnsureOnlyturgiePanelVisible() {
    if (!isPanelAutoOpenEnabled()) return;
    var run = function () {
      ensureOnlyturgiePanelVisible();
    };
    if (typeof global.setTimeout === "function") {
      global.setTimeout(run, 0);
    } else {
      run();
    }
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

  global.LstjoRuntime = {
    STORAGE_API_TOKEN_KEY: STORAGE_API_TOKEN_KEY,
    STORAGE_API_HOST_KEY: STORAGE_API_HOST_KEY,
    STORAGE_AUTH_MODE_KEY: STORAGE_AUTH_MODE_KEY,
    STORAGE_URLS_KEY: STORAGE_URLS_KEY,
    DEFAULT_SOURCE_IDS: DEFAULT_SOURCE_IDS,
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
    applyChantUrlPlaceholders: applyChantUrlPlaceholders,
    base64UrlEncodeChantName: base64UrlEncodeChantName,
    inferPanelApiUrlTemplateFromCatalogUrl: inferPanelApiUrlTemplateFromCatalogUrl,
    hasApiCredentials: hasApiCredentials,
    getCredentialsStatusMessage: getCredentialsStatusMessage,
    fetchLiturgie: fetchLiturgie,
    getFetchCredentials: getFetchCredentials,
    testCatalogSource: testCatalogSource,
    notifySettingsSaved: notifySettingsSaved,
    resetPanelAutoOpenForDocument: resetPanelAutoOpenForDocument,
    scheduleEnsureOnlyturgiePanelVisible: scheduleEnsureOnlyturgiePanelVisible,
  };
})(typeof window !== "undefined" ? window : this);
