(function (global) {
  "use strict";

  var STORAGE_API_TOKEN_KEY = "onlyturgie.apiToken";
  var STORAGE_API_HOST_KEY = "onlyturgie.apiHost";
  var STORAGE_URLS_KEY = "jsonAutocomplete.urls";

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
  var DEFAULT_API_PATH = "/apps/liturgie/api";

  function getLstjoConfig() {
    var p = global.Asc && global.Asc.plugin;
    if (!p) return {};
    if (p.lstjo && typeof p.lstjo === "object") return p.lstjo;
    if (p.variations && p.variations[0] && p.variations[0].lstjo && typeof p.variations[0].lstjo === "object") {
      return p.variations[0].lstjo;
    }
    return {};
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

  function getApiHost() {
    try {
      return normalizeHost(localStorage.getItem(STORAGE_API_HOST_KEY) || "");
    } catch (e) {
      return "";
    }
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

    if (cfg && typeof cfg.apiBase === "string" && cfg.apiBase.trim()) {
      return cfg.apiBase.trim().replace(/\/+$/, "");
    }
    return "";
  }

  function getSourceUrlTemplate(cfg) {
    cfg = cfg || getLstjoConfig();
    if (cfg && typeof cfg.sourceUrlTemplate === "string" && cfg.sourceUrlTemplate.trim()) {
      return cfg.sourceUrlTemplate.trim();
    }
    return DEFAULT_SOURCE_URL_TEMPLATE;
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
    if (!token) return "";

    var apiBase = getApiBase(cfg);
    if (!apiBase) return "";

    var segment = resolveSourceSegment(cfg, sourceId);
    if (isAbsoluteUrl(segment)) {
      try {
        var u = new URL(segment);
        u.searchParams.set("token", token);
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
    var panel = (cfg && cfg.panel) || {};
    var tpl = panel[templateKey];
    if (typeof tpl !== "string" || !tpl.trim()) return "";

    var token = getApiToken();
    var apiBase = getApiBase(cfg);
    var host = getApiHost() || apiBase;
    var resolved = applyPlaceholders(tpl.trim(), {
      host: host,
      apiBase: apiBase,
      apiPath: getApiPath(cfg),
      token: token,
    });

    if (/\{[a-zA-Z0-9]+\}/.test(resolved)) return "";
    if (resolved.indexOf("token=") !== -1 && !token) return "";
    return resolved;
  }

  function hasApiCredentials() {
    return !!getApiToken() && !!getApiBase();
  }

  global.LstjoRuntime = {
    STORAGE_API_TOKEN_KEY: STORAGE_API_TOKEN_KEY,
    STORAGE_API_HOST_KEY: STORAGE_API_HOST_KEY,
    STORAGE_URLS_KEY: STORAGE_URLS_KEY,
    DEFAULT_SOURCE_IDS: DEFAULT_SOURCE_IDS,
    getLstjoConfig: getLstjoConfig,
    getApiToken: getApiToken,
    setApiToken: setApiToken,
    getApiHost: getApiHost,
    setApiHost: setApiHost,
    getApiPath: getApiPath,
    getApiBase: getApiBase,
    getSourceIds: getSourceIds,
    getSourceUrlTemplate: getSourceUrlTemplate,
    loadLegacyUrls: loadLegacyUrls,
    resolveSourceUrl: resolveSourceUrl,
    resolveAllSourceUrls: resolveAllSourceUrls,
    resolvePanelApiTemplate: resolvePanelApiTemplate,
    hasApiCredentials: hasApiCredentials,
  };
})(typeof window !== "undefined" ? window : this);
