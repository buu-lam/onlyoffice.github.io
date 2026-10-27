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

    var token = getApiToken();
    var apiBase = getApiBase(cfg);
    if (!apiBase) return "";
    var host = getApiHost() || apiBase;
    var resolved = applyPlaceholders(tpl, {
      host: host,
      apiBase: apiBase,
      apiPath: getApiPath(cfg),
      token: token,
    });

    if (/\{[a-zA-Z0-9]+\}/.test(resolved)) return "";
    if (usesTokenInUrls(cfg) && resolved.indexOf("token=") !== -1 && !token) return "";
    return resolved;
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
    if (!getApiBase(cfg)) return false;
    if (getEffectiveAuthMode(cfg) === "nextcloud") return true;
    return !!getApiToken();
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
    inferPanelApiUrlTemplateFromCatalogUrl: inferPanelApiUrlTemplateFromCatalogUrl,
    hasApiCredentials: hasApiCredentials,
    getCredentialsStatusMessage: getCredentialsStatusMessage,
    fetchLiturgie: fetchLiturgie,
    getFetchCredentials: getFetchCredentials,
    testCatalogSource: testCatalogSource,
    notifySettingsSaved: notifySettingsSaved,
  };
})(typeof window !== "undefined" ? window : this);
