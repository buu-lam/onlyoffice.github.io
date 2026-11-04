(function () {
  "use strict";

  var STORAGE_URLS_KEY = "jsonAutocomplete.urls";
  var STORAGE_DATA_KEY = "jsonAutocomplete.itemsBySource";
  var STORAGE_PDF_RATIO_KEY = "onlyturgie.panelPdfRatioEqual";
  var DEFAULT_PDF_RATIO = 0.5;
  var MIN_PDF_RATIO = 0.15;
  var MAX_PDF_RATIO = 0.85;

  var chantList = [];
  var debounceTimer = null;
  var chantStatusEl = null;
  var credentialsBarEl = null;
  var chantApiStatusEl = null;

  var CHANT_API_ICON_OK =
    '<svg class="panel-chant-api-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>';
  var CHANT_API_ICON_ERROR =
    '<svg class="panel-chant-api-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.29 19.71 2.88 18.3 9.17 12 2.88 5.71 4.29 4.3 10.59 10.6l6.29-6.3z"/></svg>';

  /** @param {'idle'|'loading'|'ok'|'error'} state */
  function setChantApiStatus(state, detail) {
    var el = chantApiStatusEl || document.getElementById("panel-chant-api-status");
    if (!el) return;
    var labels = {
      idle: "API chant : en attente",
      loading: "Chargement du catalogue chant…",
      ok: "API chant : catalogue chargé",
      error: "API chant : échec du chargement",
    };
    var label = detail || labels[state] || labels.idle;
    el.className = "panel-chant-api-status panel-chant-api-status--" + state;
    el.setAttribute("data-state", state);
    el.title = label;
    el.setAttribute("aria-label", label);
    var iconWrap = el.querySelector(".panel-chant-api-icon");
    if (state === "loading") {
      if (!iconWrap || iconWrap.tagName !== "SPAN" || !iconWrap.classList.contains("panel-chant-api-icon")) {
        el.innerHTML = '<span class="panel-chant-api-icon" aria-hidden="true"></span>';
      }
    } else if (state === "ok") {
      el.innerHTML = CHANT_API_ICON_OK;
    } else if (state === "error") {
      el.innerHTML = CHANT_API_ICON_ERROR;
    } else {
      el.innerHTML = '<span class="panel-chant-api-icon" aria-hidden="true"></span>';
    }
  }
  /** État courant panneau (chemins racine Nextcloud, listes fichiers). */
  var panelResolveState = {
    pdfPathFull: "",
    pptPathFull: "",
    pdfFiles: [],
    pptFiles: [],
    pdfIndex: 0,
    pptIndex: 0,
    chantKey: "",
  };
  var splitApplyRatioFn = null;
  /** Incrémenté à chaque résolution pour ignorer les réponses API obsolètes. */
  var resolveSeq = 0;
  /** Ignore les callbacks getCursorText / callCommand périmés quand onTargetPositionChanged se répète. */
  var pendingCursorResolveId = 0;
  /** Dernier contexte (ligne + chant) déjà résolu — évite les relances si onTargetPositionChanged boucle. */
  var lastSettledResolveKey = "";
  var lastSettledResolve = null;
  /** Requêtes PDF/PPT en cours pour un chant (évite les doublons avant lastSettled). */
  var inFlightChantFetch = null;
  /** PDF chargé en blob: (évite X-Frame-Options Nextcloud dans l’iframe du panneau). */
  var pdfBlobObjectUrl = "";
  var pdfBlobSourceUrl = "";
  var pdfBlobLoadSeq = 0;
  /** Cache LRU des PDF déjà téléchargés : URL fichier (versionnée ?v=etag) → blob: URL. */
  var PDF_BLOB_CACHE_MAX = 12;
  var pdfBlobCache = [];
  /** Cache LRU des résolutions chant → fichiers PDF/PPT (revenir sur un chant = instantané). */
  var RESOLVE_CACHE_MAX = 60;
  var RESOLVE_CACHE_TTL_MS = 5 * 60 * 1000;
  var resolveCache = [];
  /** Présentation via DocsAPI (pptUseOfficeViewer === false). */
  var pptDocEditor = null;
  var pptDocsApiSourceUrl = "";
  var pptDocsApiLoadSeq = 0;
  var pptDocsApiScriptLoading = false;
  var pptDocsApiScriptWaiters = [];
  var pptDocsApiScriptDsUrl = "";
  /** Div enfant de #oo-ppt-editor que DocsAPI remplace par son iframe. */
  var PPT_EDITOR_FRAME_ID = "oo-ppt-editor-frame";
  /**
   * onTargetPositionChanged se répète (~0,4 s, y compris sans action de l’utilisateur) et réapplique les volets.
   * Sans ces états, chaque répétition annulait le chargement en cours (panel-config, téléchargement PDF)
   * et le relançait — la présentation pouvait ne jamais s’afficher, et une erreur bouclait.
   */
  var pptDocsApiPhase = ""; // "" | "loading" | "ready" | "error" (pour pptDocsApiSourceUrl)
  var pptDocsApiPhaseAt = 0;
  var pdfBlobPendingUrl = "";
  var pdfBlobPendingSeq = 0;
  var pdfBlobFailedUrl = "";
  var pdfBlobFailedAt = 0;
  /** Délai avant de retenter un fichier en erreur. */
  var PANE_RETRY_AFTER_MS = 15000;
  /** Au-delà, un chargement présentation sans onDocumentReady/onError est considéré bloqué. */
  var PPT_LOADING_STALE_MS = 60000;

  function setPptDocsApiPhase(phase) {
    pptDocsApiPhase = phase;
    pptDocsApiPhaseAt = Date.now();
  }

  function resolveCacheGet(key) {
    var now = Date.now();
    for (var i = 0; i < resolveCache.length; i++) {
      var e = resolveCache[i];
      if (e.key !== key) continue;
      resolveCache.splice(i, 1);
      if (now - e.at > RESOLVE_CACHE_TTL_MS) return null;
      resolveCache.push(e);
      return e.snapshot;
    }
    return null;
  }

  function resolveCachePut(key, snapshot) {
    for (var i = 0; i < resolveCache.length; i++) {
      if (resolveCache[i].key === key) {
        resolveCache.splice(i, 1);
        break;
      }
    }
    resolveCache.push({ key: key, at: Date.now(), snapshot: snapshot });
    while (resolveCache.length > RESOLVE_CACHE_MAX) resolveCache.shift();
  }

  function pdfBlobCacheGet(sourceUrl) {
    for (var i = 0; i < pdfBlobCache.length; i++) {
      if (pdfBlobCache[i].src === sourceUrl) {
        var e = pdfBlobCache.splice(i, 1)[0];
        pdfBlobCache.push(e);
        return e.objectUrl;
      }
    }
    return "";
  }

  function pdfBlobCachePut(sourceUrl, objectUrl) {
    pdfBlobCache.push({ src: sourceUrl, objectUrl: objectUrl });
    while (pdfBlobCache.length > PDF_BLOB_CACHE_MAX) {
      var old = pdfBlobCache.shift();
      if (old.objectUrl === pdfBlobObjectUrl) {
        // Affiché en ce moment : on le garde (remis en fin de liste).
        pdfBlobCache.push(old);
        if (pdfBlobCache.length <= PDF_BLOB_CACHE_MAX) break;
        continue;
      }
      try {
        URL.revokeObjectURL(old.objectUrl);
      } catch (eRevoke) {
        /* ignore */
      }
    }
  }

  function clearPanelCaches() {
    resolveCache = [];
    pdfBlobCache.forEach(function (e) {
      try {
        URL.revokeObjectURL(e.objectUrl);
      } catch (eRevoke) {
        /* ignore */
      }
    });
    pdfBlobCache = [];
    pdfBlobObjectUrl = "";
    pdfBlobSourceUrl = "";
    pdfBlobPendingUrl = "";
    pdfBlobFailedUrl = "";
  }

  function getLstjoConfig() {
    var p = window.Asc.plugin;
    if (!p) return {};
    if (p.lstjo && typeof p.lstjo === "object") return p.lstjo;
    if (p.variations && p.variations[0] && p.variations[0].lstjo && typeof p.variations[0].lstjo === "object") {
      return p.variations[0].lstjo;
    }
    return {};
  }

  function getPanelCfg() {
    var cfg = getLstjoConfig();
    return (cfg && cfg.panel) || {};
  }

  /**
   * Bornes pour resizeWindow : si panelResizable est false, min = max pour figer la taille.
   */
  function getPanelSizeBounds() {
    var panel = getPanelCfg();
    var w = typeof panel.panelWidth === "number" && panel.panelWidth > 0 ? panel.panelWidth : 520;
    var h = typeof panel.panelHeight === "number" && panel.panelHeight > 0 ? panel.panelHeight : 720;
    var minW = typeof panel.panelMinWidth === "number" && panel.panelMinWidth > 0 ? panel.panelMinWidth : Math.min(500, w);
    var minH = typeof panel.panelMinHeight === "number" && panel.panelMinHeight > 0 ? panel.panelMinHeight : 400;
    var maxW = typeof panel.panelMaxWidth === "number" && panel.panelMaxWidth > 0 ? panel.panelMaxWidth : 1600;
    var maxH = typeof panel.panelMaxHeight === "number" && panel.panelMaxHeight > 0 ? panel.panelMaxHeight : 2000;
    if (minW > w) minW = w;
    if (minH > h) minH = h;
    if (maxW < w) maxW = w;
    if (maxH < h) maxH = h;
    var resizable = panel.panelResizable !== false;
    if (!resizable) {
      minW = maxW = w;
      minH = maxH = h;
    }
    return { w: w, h: h, minW: minW, minH: minH, maxW: maxW, maxH: maxH, resizable: resizable };
  }

  /**
   * Largeur / hauteur du panneau droit (API OnlyOffice : resizeWindow).
   * Avec panelResizable true, min < max permet aussi le redimensionnement via l’UI éditeur si disponible.
   */
  function applyPanelWindowSize() {
    var b = getPanelSizeBounds();
    if (window.Asc && window.Asc.plugin && typeof window.Asc.plugin.resizeWindow === "function") {
      window.Asc.plugin.resizeWindow(b.w, b.h, b.minW, b.minH, b.maxW, b.maxH);
    }
  }

  function normalizeData(payload) {
    var source = payload;
    if (!Array.isArray(source)) {
      if (source && Array.isArray(source.items)) {
        source = source.items;
      } else if (source && Array.isArray(source.data)) {
        source = source.data;
      } else {
        source = [];
      }
    }
    return source
      .map(function (item) {
        if (typeof item === "string") return item;
        if (!item || typeof item !== "object") return "";
        return item.text || item.label || item.value || item.name || "";
      })
      .map(function (text) {
        return String(text).trim();
      })
      .filter(Boolean);
  }

  function loadUrlsFromStorage() {
    try {
      var raw = localStorage.getItem(STORAGE_URLS_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      var out = {};
      Object.keys(parsed).forEach(function (k) {
        if (typeof parsed[k] === "string") out[k] = parsed[k];
      });
      return out;
    } catch (e) {
      return {};
    }
  }

  function loadItemsFromStorage() {
    try {
      var raw = localStorage.getItem(STORAGE_DATA_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      var out = {};
      Object.keys(parsed).forEach(function (k) {
        if (Array.isArray(parsed[k])) {
          out[k] = parsed[k].map(function (item) {
            return String(item);
          });
        }
      });
      return out;
    } catch (e) {
      return {};
    }
  }

  function publishChantCatalogForAutocomplete(cfg, items, sourceId) {
    if (!items || !items.length) return;
    sourceId =
      sourceId ||
      ((cfg && cfg.panel && typeof cfg.panel.sourceId === "string" && cfg.panel.sourceId) || "chant");
    try {
      var map = loadItemsFromStorage();
      map[sourceId] = items.slice();
      localStorage.setItem(STORAGE_DATA_KEY, JSON.stringify(map));
      if (window.LstjoRuntime && typeof window.LstjoRuntime.resolveAllSourceUrls === "function") {
        localStorage.setItem(
          STORAGE_URLS_KEY,
          JSON.stringify(window.LstjoRuntime.resolveAllSourceUrls(cfg || getLstjoConfig()))
        );
      }
    } catch (ePub) {
      /* ignore */
    }
    try {
      if (window.Asc && window.Asc.plugin && typeof window.Asc.plugin.sendToPlugin === "function") {
        window.Asc.plugin.sendToPlugin("onlyturgie.catalogUpdated", {
          sourceId: sourceId,
          count: items.length,
          at: Date.now(),
        });
      }
    } catch (eSend) {
      /* ignore */
    }
  }

  function mergeChantList(cfg, sourceId, fetched) {
    var inline = (cfg.inlineItems && cfg.inlineItems[sourceId]) || [];
    var inlineNorm = inline
      .map(function (x) {
        return String(x).trim();
      })
      .filter(Boolean);
    var seen = {};
    var out = [];
    function pushUnique(s) {
      if (!s || seen[s]) return;
      seen[s] = true;
      out.push(s);
    }
    fetched.forEach(pushUnique);
    inlineNorm.forEach(pushUnique);
    return out;
  }

  async function loadChantList(cfg, options) {
    options = options || {};
    var reportStatus = options.reportStatus !== false;
    var panel = (cfg && cfg.panel) || {};
    var sourceId = typeof panel.sourceId === "string" && panel.sourceId ? panel.sourceId : "chant";

    var storedItems = loadItemsFromStorage();
    var cached = storedItems[sourceId] && storedItems[sourceId].length ? storedItems[sourceId] : [];

    var url = "";
    if (window.LstjoRuntime && typeof window.LstjoRuntime.resolveSourceUrl === "function") {
      url = window.LstjoRuntime.resolveSourceUrl(sourceId, cfg);
    } else {
      var urls = loadUrlsFromStorage();
      var sources = (cfg && cfg.sources) || {};
      url = (urls[sourceId] || String(sources[sourceId] || "")).trim();
    }

    if (!url) {
      if (reportStatus) {
        setChantApiStatus("error", "API chant : hôte ou jeton manquant");
      }
      var offlineList = mergeChantList(cfg, sourceId, cached);
      publishChantCatalogForAutocomplete(cfg, offlineList, sourceId);
      return offlineList;
    }

    if (reportStatus) setChantApiStatus("loading");

    try {
      var response = window.LstjoRuntime && window.LstjoRuntime.fetchLiturgie
        ? await window.LstjoRuntime.fetchLiturgie(url)
        : await fetch(url, { method: "GET" });
      if (!response.ok) {
        if (reportStatus) {
          setChantApiStatus("error", "API chant : échec HTTP " + response.status);
        }
        var fallbackList = mergeChantList(cfg, sourceId, cached);
        publishChantCatalogForAutocomplete(cfg, fallbackList, sourceId);
        return fallbackList;
      }
      var payload = await response.json();
      if (reportStatus) setChantApiStatus("ok");
      var freshList = mergeChantList(cfg, sourceId, normalizeData(payload));
      publishChantCatalogForAutocomplete(cfg, freshList, sourceId);
      return freshList;
    } catch (e) {
      if (reportStatus) {
        setChantApiStatus("error", "API chant : erreur réseau ou timeout");
      }
      var errList = mergeChantList(cfg, sourceId, cached);
      publishChantCatalogForAutocomplete(cfg, errList, sourceId);
      return errList;
    }
  }

  function slugify(s) {
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

  function applyUrlTemplate(template, chantName) {
    if (window.LstjoRuntime && typeof window.LstjoRuntime.applyChantUrlPlaceholders === "function") {
      return window.LstjoRuntime.applyChantUrlPlaceholders(template, chantName);
    }
    if (!template) return "";
    return String(template);
  }

  function fileNameFromPath(path) {
    var p = String(path || "").trim();
    if (!p) return "";
    var parts = p.split("/");
    return parts[parts.length - 1] || p;
  }

  function normalizePanelFileEntry(raw, jsonUrlKey) {
    if (!raw || typeof raw !== "object") return null;
    var url =
      typeof raw.url === "string"
        ? raw.url.trim()
        : extractUrlFromJson(raw, jsonUrlKey || "url");
    var pathFull = typeof raw.path_full === "string" ? raw.path_full.trim() : "";
    if (!pathFull && typeof raw.path === "string") pathFull = raw.path.trim();
    var name =
      typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim()
        : fileNameFromPath(pathFull || url);
    if (!url && !pathFull) return null;
    return { url: url, path_full: pathFull, name: name || fileNameFromPath(url) };
  }

  function panelFilesFromApiPayload(data, jsonUrlKey) {
    var key = jsonUrlKey || "url";
    var files = [];
    if (Array.isArray(data)) {
      data.forEach(function (item) {
        var e = normalizePanelFileEntry(item, key);
        if (e) files.push(e);
      });
    } else if (data && typeof data === "object") {
      if (Array.isArray(data.files)) {
        data.files.forEach(function (item) {
          var e = normalizePanelFileEntry(item, key);
          if (e) files.push(e);
        });
      }
      if (!files.length && Array.isArray(data.items)) {
        data.items.forEach(function (item) {
          var e = normalizePanelFileEntry(item, key);
          if (e) files.push(e);
        });
      }
      if (!files.length) {
        var single = normalizePanelFileEntry(data, key);
        if (single) files.push(single);
      }
    }
    return files;
  }

  function pickDefaultFileIndex(files, chantName, kind) {
    if (!files || files.length <= 1) return 0;
    var fold = String(chantName || "").trim();
    var wantPdf = fold + ".pdf";
    var wantPptx = fold + ".pptx";
    var wantPpt = fold + ".ppt";
    for (var i = 0; i < files.length; i++) {
      var n = (files[i].name || fileNameFromPath(files[i].path_full)).toLowerCase();
      if (kind === "pdf" && n === wantPdf.toLowerCase()) return i;
      if (kind === "ppt" && (n === wantPptx.toLowerCase() || n === wantPpt.toLowerCase())) return i;
    }
    return 0;
  }

  function dedupePanelFiles(files) {
    var seen = {};
    var out = [];
    (files || []).forEach(function (f) {
      var k = (f.path_full || f.url || f.name || "").toLowerCase();
      if (!k || seen[k]) return;
      seen[k] = true;
      out.push(f);
    });
    return out;
  }

  /**
   * Appelle directement /api/{pdf|ppt}/all (liste) — une requête au lieu de /api/pdf puis /all.
   * Résultat : { files } si OK ; { definitiveError } si l’API liturgie a répondu une erreur JSON (404 fichier
   * introuvable, 403…) ; null si la route liste semble absente (ancien serveur) → repli sur /api/pdf.
   */
  function tryFetchPanelFileList(chantName, kind, cfg, jsonUrlKey, apiTpl) {
    var listTpl =
      window.LstjoRuntime && typeof window.LstjoRuntime.resolvePanelListApiTemplate === "function"
        ? window.LstjoRuntime.resolvePanelListApiTemplate(cfg, kind)
        : "";
    if (!listTpl && apiTpl) {
      var derived = String(apiTpl).replace(/\/api\/(pdf|ppt)(\?|$)/i, "/api/$1/all$2");
      if (derived !== apiTpl) listTpl = derived;
    }
    if (!listTpl) return Promise.resolve(null);
    // Diapo : la liste doit viser le même périmètre que apiTpl (scope=diapo + document ouvert).
    if (/[?&]scope=diapo/.test(String(apiTpl || "")) && window.LstjoRuntime) {
      listTpl = window.LstjoRuntime.withDocumentContext(window.LstjoRuntime.withDiapoScope(listTpl));
    }
    var listUrl = ensureTokenOnApiUrl(applyUrlTemplate(listTpl, chantName), cfg || getLstjoConfig());
    if (!listUrl) return Promise.resolve(null);
    var fetchFn =
      window.LstjoRuntime && typeof window.LstjoRuntime.fetchLiturgie === "function"
        ? function (u) {
            return window.LstjoRuntime.fetchLiturgie(u);
          }
        : function (u) {
            return fetch(u, { method: "GET", credentials: "omit" });
          };
    return fetchFn(listUrl)
      .then(function (response) {
        return response.text().then(function (body) {
          var payload = null;
          try {
            payload = JSON.parse(body);
          } catch (eJson) {
            payload = null;
          }
          if (!response.ok) {
            // Réponse JSON de l’app liturgie (route présente) : inutile de retenter /api/pdf.
            if (payload && typeof payload.message === "string" && payload.message.trim()) {
              var hint =
                response.status === 404
                  ? " (pas de fichier dans le dossier chant sur Nextcloud ?)"
                  : response.status === 403
                    ? " (jeton ou droits API)"
                    : "";
              return { definitiveError: "HTTP " + response.status + hint + " — " + payload.message.trim() };
            }
            return null;
          }
          if (!payload) return null;
          var files = dedupePanelFiles(panelFilesFromApiPayload(payload, jsonUrlKey)).filter(function (f) {
            return isUsablePanelFileUrl(f.url);
          });
          return files.length ? { files: files } : null;
        });
      })
      .catch(function () {
        return null;
      });
  }

  /** Liste d’abord ; repli sur l’ancienne API métadonnées (/api/pdf, /api/ppt) seulement si besoin. */
  function fetchPanelAsset(kind, chantName, apiTpl, cfg, jsonUrlKey) {
    return tryFetchPanelFileList(chantName, kind, cfg, jsonUrlKey, apiTpl).then(function (listed) {
      if (listed && listed.files && listed.files.length) {
        var idx = pickDefaultFileIndex(listed.files, chantName, kind);
        var pick = listed.files[idx] || listed.files[0];
        return { url: pick.url || "", path_full: pick.path_full || "", files: listed.files, error: "" };
      }
      if (listed && listed.definitiveError) {
        return { url: "", path_full: "", files: [], error: listed.definitiveError, definitive: true };
      }
      return fetchUrlFromApi(apiTpl, chantName, jsonUrlKey, cfg);
    });
  }

  function updateFilePickerUi(kind, files, selectedIndex, chantName) {
    var selectEl = document.getElementById("select-" + kind);
    var countEl = document.getElementById("count-" + kind);
    if (!selectEl) return;
    var list = files || [];
    if (list.length <= 1) {
      selectEl.hidden = true;
      selectEl.innerHTML = "";
      if (countEl) countEl.hidden = true;
      return;
    }
    selectEl.hidden = false;
    selectEl.innerHTML = "";
    list.forEach(function (file, i) {
      var opt = document.createElement("option");
      opt.value = String(i);
      var label = file.name || fileNameFromPath(file.path_full) || file.url || "Fichier " + (i + 1);
      if (file.path_full && file.path_full !== label) {
        label = label + " — " + file.path_full;
      }
      opt.textContent = label;
      selectEl.appendChild(opt);
    });
    selectEl.value = String(Math.max(0, Math.min(selectedIndex, list.length - 1)));
    if (countEl) {
      if (kind === "pdf") {
        countEl.hidden = false;
        countEl.textContent = list.length + " PDF trouvés";
      } else {
        countEl.hidden = false;
        countEl.textContent = list.length + " présentations trouvées";
      }
    }
  }

  function applyPanelFileSelection(kind, index, pptUseOfficeViewer) {
    var files = kind === "pdf" ? panelResolveState.pdfFiles : panelResolveState.pptFiles;
    if (!files || !files.length) return;
    var i = Math.max(0, Math.min(index, files.length - 1));
    var file = files[i];
    // Mémoriser le choix : sinon le prochain onTargetPositionChanged (~0,4 s) réapplique lastSettledResolve
    // (fichier par défaut) et annule la sélection de l’utilisateur.
    if (lastSettledResolve && !lastSettledResolve.noChant && lastSettledResolveKey === panelResolveState.chantKey) {
      lastSettledResolve[kind + "Index"] = i;
      lastSettledResolve[kind + "Url"] = file.url || "";
      lastSettledResolve[kind + "PathFull"] = file.path_full || "";
      resolveCachePut(lastSettledResolveKey, lastSettledResolve);
    }
    if (kind === "pdf") {
      panelResolveState.pdfIndex = i;
      panelResolveState.pdfPathFull = file.path_full || "";
      bindPane("pdf", file.url || "");
    } else {
      panelResolveState.pptIndex = i;
      panelResolveState.pptPathFull = file.path_full || "";
      bindPane("ppt", file.url || "", function (u) {
        return resolvePptIframeSrc(u, pptUseOfficeViewer !== false);
      });
    }
    updateFilePickerUi(kind, files, i, "");
  }

  function syncPanelResolveStateToUi(snapshot, pptUseOfficeViewer) {
    if (snapshot && snapshot.chantKey !== undefined) {
      panelResolveState.chantKey = snapshot.chantKey;
    }
    if (snapshot && snapshot.pdfFiles) {
      panelResolveState.pdfFiles = snapshot.pdfFiles;
      panelResolveState.pdfIndex =
        typeof snapshot.pdfIndex === "number" ? snapshot.pdfIndex : pickDefaultFileIndex(snapshot.pdfFiles, snapshot.chant, "pdf");
      panelResolveState.pdfPathFull =
        snapshot.pdfPathFull ||
        (snapshot.pdfFiles[panelResolveState.pdfIndex] && snapshot.pdfFiles[panelResolveState.pdfIndex].path_full) ||
        "";
    }
    if (snapshot && snapshot.pptFiles) {
      panelResolveState.pptFiles = snapshot.pptFiles;
      panelResolveState.pptIndex =
        typeof snapshot.pptIndex === "number" ? snapshot.pptIndex : pickDefaultFileIndex(snapshot.pptFiles, snapshot.chant, "ppt");
      panelResolveState.pptPathFull =
        snapshot.pptPathFull ||
        (snapshot.pptFiles[panelResolveState.pptIndex] && snapshot.pptFiles[panelResolveState.pptIndex].path_full) ||
        "";
    }
    updateFilePickerUi("pdf", panelResolveState.pdfFiles, panelResolveState.pdfIndex, snapshot && snapshot.chant);
    updateFilePickerUi("ppt", panelResolveState.pptFiles, panelResolveState.pptIndex, snapshot && snapshot.chant);
  }

  function readAutocompleteEnabled() {
    if (window.LstjoRuntime && typeof window.LstjoRuntime.readAutocompleteEnabledPreference === "function") {
      return window.LstjoRuntime.readAutocompleteEnabledPreference();
    }
    return true;
  }

  function writeAutocompleteEnabled(enabled) {
    if (window.LstjoRuntime && typeof window.LstjoRuntime.writeAutocompleteEnabledPreference === "function") {
      window.LstjoRuntime.writeAutocompleteEnabledPreference(!!enabled);
    }
  }

  function notifyAutocompleteToggled(enabled) {
    try {
      if (window.Asc && window.Asc.plugin && typeof window.Asc.plugin.sendToPlugin === "function") {
        window.Asc.plugin.sendToPlugin("onlyturgie.autocompleteToggled", { enabled: !!enabled, at: Date.now() });
      }
    } catch (e) {
      /* ignore */
    }
  }

  function syncAutocompleteToggleUi() {
    var btn = document.getElementById("panel-autocomplete-toggle");
    var labelEl = document.getElementById("panel-autocomplete-toggle-label");
    if (!btn) return;
    var on = readAutocompleteEnabled();
    btn.classList.toggle("is-on", on);
    btn.classList.toggle("is-off", !on);
    btn.setAttribute("aria-checked", on ? "true" : "false");
    var statusLabel = on ? "Auto. : activée" : "Auto. : off";
    if (labelEl) labelEl.textContent = statusLabel;
    btn.setAttribute("aria-label", statusLabel);
    btn.title = on
      ? "Cliquer pour désactiver l’autocomplétion liturgique dans le document"
      : "Cliquer pour activer l’autocomplétion liturgique dans le document";
  }

  function initPanelHeader() {
    syncAutocompleteToggleUi();
    var versionEl = document.getElementById("panel-plugin-version");
    function showVersion(v) {
      if (versionEl) versionEl.textContent = v ? "v" + v : "";
    }
    if (window.LstjoRuntime && typeof window.LstjoRuntime.getPluginVersionString === "function") {
      var direct = window.LstjoRuntime.getPluginVersionString();
      if (direct) showVersion(direct);
      else if (typeof window.LstjoRuntime.loadPluginVersionFromConfig === "function") {
        window.LstjoRuntime.loadPluginVersionFromConfig(showVersion);
      }
    }
    var toggleBtn = document.getElementById("panel-autocomplete-toggle");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", function (e) {
        e.preventDefault();
        var next = !readAutocompleteEnabled();
        writeAutocompleteEnabled(next);
        syncAutocompleteToggleUi();
        notifyAutocompleteToggled(next);
      });
    }
    var gearBtn = document.getElementById("panel-open-settings-gear");
    if (gearBtn) {
      gearBtn.addEventListener("click", function (e) {
        e.preventDefault();
        openSettingsFromPanel();
      });
    }
    var selPdf = document.getElementById("select-pdf");
    var selPpt = document.getElementById("select-ppt");
    if (selPdf) {
      selPdf.addEventListener("change", function () {
        applyPanelFileSelection("pdf", parseInt(selPdf.value, 10) || 0, getPanelCfg().pptUseOfficeViewer !== false);
      });
    }
    if (selPpt) {
      selPpt.addEventListener("change", function () {
        applyPanelFileSelection("ppt", parseInt(selPpt.value, 10) || 0, getPanelCfg().pptUseOfficeViewer !== false);
      });
    }
  }

  /** Extrait une URL depuis la réponse JSON (clé simple ou chemin type "data.url"). */
  function extractUrlFromJson(data, keyPath) {
    if (!data || typeof data !== "object") return "";
    var path = (keyPath || "url").trim();
    if (!path) path = "url";
    var parts = path.split(".");
    var cur = data;
    for (var i = 0; i < parts.length; i++) {
      if (!cur || typeof cur !== "object") return "";
      cur = cur[parts[i]];
    }
    return typeof cur === "string" ? cur.trim() : "";
  }

  function isUsablePanelFileUrl(url) {
    var trimmed = (url || "").trim();
    if (!trimmed) return false;
    try {
      var u = new URL(trimmed);
      var p = u.pathname || "";
      if (p === "/" || p === "") return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  function ensureTokenOnApiUrl(apiUrl, cfg) {
    if (!apiUrl || apiUrl.indexOf("token=") !== -1) return apiUrl;
    if (!window.LstjoRuntime || typeof window.LstjoRuntime.getEffectiveApiToken !== "function") {
      return apiUrl;
    }
    var panel = (cfg && cfg.panel) || {};
    var sourceId = typeof panel.sourceId === "string" && panel.sourceId ? panel.sourceId : "chant";
    var token = window.LstjoRuntime.getEffectiveApiToken(cfg, sourceId);
    if (!token) return apiUrl;
    try {
      var u = new URL(apiUrl);
      u.searchParams.set("token", token);
      return u.toString();
    } catch (e2) {
      return apiUrl;
    }
  }

  function fetchUrlFromApi(apiTemplate, chantName, jsonUrlKey, cfg) {
    var apiUrl = ensureTokenOnApiUrl(applyUrlTemplate(apiTemplate, chantName), cfg || getLstjoConfig());
    if (!apiUrl) {
      return Promise.resolve({ url: "", path_full: "", files: [], error: "Modèle API vide (hôte ou jeton manquant ?)." });
    }
    var fetchFn =
      window.LstjoRuntime && typeof window.LstjoRuntime.fetchLiturgie === "function"
        ? function (u) {
            return window.LstjoRuntime.fetchLiturgie(u);
          }
        : function (u) {
            return fetch(u, { method: "GET", credentials: "omit" });
          };
    return fetchFn(apiUrl)
      .then(function (response) {
        return response.text().then(function (body) {
          if (!response.ok) {
            var preview = (body || "").trim().slice(0, 160);
            var hint =
              response.status === 404
                ? " (pas de PDF/PPT dans le dossier chant sur Nextcloud ?)"
                : response.status === 403
                  ? " (jeton ou droits API)"
                  : "";
            throw new Error("HTTP " + response.status + hint + (preview ? " — " + preview : ""));
          }
          try {
            return JSON.parse(body);
          } catch (eJson) {
            throw new Error("Réponse non JSON : " + (body || "").trim().slice(0, 120));
          }
        });
      })
      .then(function (data) {
        var files = dedupePanelFiles(panelFilesFromApiPayload(data, jsonUrlKey));
        var url = extractUrlFromJson(data, jsonUrlKey);
        if (!url && files.length) url = files[0].url || "";
        var pathFull = typeof data.path_full === "string" ? data.path_full.trim() : "";
        if (!pathFull && files.length) pathFull = files[0].path_full || "";
        if (isUsablePanelFileUrl(url)) {
          return { url: url, path_full: pathFull, files: files, error: "" };
        }
        var msg =
          data && typeof data.message === "string" && data.message.trim()
            ? data.message.trim()
            : url
              ? "URL refusée (chemin vide ou racine du site) : " + url
              : "Pas de clé « " + jsonUrlKey + " » dans la réponse JSON.";
        return { url: "", path_full: pathFull, files: files, error: msg };
      })
      .catch(function (err) {
        return {
          url: "",
          path_full: "",
          files: [],
          error: String(err && err.message ? err.message : err),
        };
      });
  }

  /** Déduit {pdf,ppt}ApiUrlTemplate depuis l'URL d'un catalogue /api/<segment> (chant, kyrie, etc.). */
  function inferApiUrlTemplateFromChantsUrl(chantsUrl, targetKind) {
    if (!chantsUrl || typeof chantsUrl !== "string") return "";
    var trimmed = chantsUrl.trim();
    if (!trimmed) return "";

    var u;
    try {
      u = new URL(trimmed);
    } catch (e) {
      return "";
    }

    // Le contrôleur lit token en paramètre ?token=... ou en Bearer (mais ici on préfère le paramètre).
    var token = "";
    try {
      token = u.searchParams.get("token") || "";
    } catch (e2) {
      token = "";
    }
    if (!token) return "";

    var pathname = u.pathname || "";
    // Remplace le dernier segment .../api/<nom> par .../api/{pdf|ppt}
    var newPath = pathname.replace(/\/api\/[^/]+$/i, "/api/" + targetKind);
    if (newPath === pathname) return "";

    // hash attend le nom de sous-dossier encodé en base64 URL-safe (LstjoRuntime.base64UrlEncodeChantName).
    return u.origin + newPath + "?token=" + encodeURIComponent(token) + "&hash={base64url}";
  }

  function resolveChantsSourceUrl(cfg, sourceId) {
    if (!cfg) return "";
    if (window.LstjoRuntime && typeof window.LstjoRuntime.resolveSourceUrl === "function") {
      return window.LstjoRuntime.resolveSourceUrl(sourceId, cfg);
    }
    var urls = loadUrlsFromStorage();
    var sources = (cfg && cfg.sources) || {};
    var fromStorage = urls && urls[sourceId] ? urls[sourceId] : "";
    var fromCfg = sources && sources[sourceId] ? sources[sourceId] : "";
    return String(fromStorage || fromCfg || "").trim();
  }

  function normalizeForMatch(s) {
    return String(s || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function findMatchingChant(lineText, list, chantMatch) {
    if (!lineText || !list || !list.length) return null;
    var normLine = normalizeForMatch(lineText);
    if (!normLine) return null;

    if (chantMatch === "contains") {
      var sorted = list.slice().sort(function (a, b) {
        return String(b).length - String(a).length;
      });
      for (var i = 0; i < sorted.length; i++) {
        var c = sorted[i];
        if (!c) continue;
        var n = normalizeForMatch(c);
        if (normLine.indexOf(n) !== -1) return String(c).trim();
      }
      return null;
    }

    for (var j = 0; j < list.length; j++) {
      var ch = list[j];
      if (normalizeForMatch(ch) === normLine) return String(ch).trim();
    }
    return null;
  }

  function isAlreadyEmbedUrl(url) {
    if (!url) return false;
    var u = url.toLowerCase();
    if (u.indexOf("view.officeapps.live.com") !== -1) return true;
    if (u.indexOf("docs.google.com/presentation") !== -1 && u.indexOf("/embed") !== -1) return true;
    if (u.indexOf("office.com/embed") !== -1) return true;
    return false;
  }

  function resolvePptIframeSrc(url, useOfficeViewer) {
    var trimmed = (url || "").trim();
    if (!trimmed) return "";
    if (isAlreadyEmbedUrl(trimmed)) return trimmed;
    if (useOfficeViewer === false) return trimmed;
    return "https://view.officeapps.live.com/op/embed.aspx?src=" + encodeURIComponent(trimmed);
  }

  function getDocumentServerUrlForPanel() {
    var panel = getPanelCfg();
    var ds = typeof panel.documentServerUrl === "string" ? panel.documentServerUrl.trim() : "";
    if (ds) {
      return ds.replace(/\/?$/, "/");
    }
    if (window.LstjoRuntime && typeof window.LstjoRuntime.getEditorDocumentServerOrigin === "function") {
      var fromBridge = window.LstjoRuntime.getEditorDocumentServerOrigin();
      if (fromBridge) return fromBridge.replace(/\/?$/, "/");
    }
    try {
      if (window.parent && window.parent !== window && window.parent.location && window.parent.location.origin) {
        return window.parent.location.origin + "/";
      }
    } catch (eParent) {
      /* cross-origin */
    }
    if (window.location && window.location.origin) {
      return window.location.origin + "/";
    }
    return "http://127.0.0.1:8080/";
  }

  function buildPptOnlyOfficeConfigFetchUrl(documentUrl, cfg, fileTitle) {
    cfg = cfg || getLstjoConfig();
    var apiBase =
      window.LstjoRuntime && typeof window.LstjoRuntime.getApiBase === "function"
        ? window.LstjoRuntime.getApiBase(cfg)
        : "";
    if (!apiBase) return "";
    var token =
      window.LstjoRuntime && typeof window.LstjoRuntime.getEffectiveApiToken === "function"
        ? window.LstjoRuntime.getEffectiveApiToken(cfg, "chant") || ""
        : "";
    var q = "documentUrl=" + encodeURIComponent(documentUrl);
    if (token) {
      q += "&token=" + encodeURIComponent(token);
    }
    var title = (fileTitle || "").trim();
    if (!title && panelResolveState.pptPathFull) {
      var parts = String(panelResolveState.pptPathFull).split("/");
      title = parts[parts.length - 1] || "";
    }
    if (title) {
      q += "&title=" + encodeURIComponent(title);
    }
    return apiBase + "/onlyoffice/panel-config?" + q;
  }

  function destroyPptDocEditor() {
    if (pptDocEditor && typeof pptDocEditor.destroyEditor === "function") {
      try {
        pptDocEditor.destroyEditor();
      } catch (eDestroy) {
        /* ignore */
      }
    }
    pptDocEditor = null;
    var host = document.getElementById("oo-ppt-editor");
    if (host) {
      host.innerHTML = "";
      host.hidden = true;
    }
  }

  function normalizeDsUrl(dsUrl) {
    return String(dsUrl || "").trim().replace(/\/?$/, "/");
  }

  /**
   * Charge api.js du Document Server une seule fois. api.js déduit l’origine DS de son propre src :
   * si un autre DS est demandé (préchargement vs panel-config), on recharge le script.
   */
  function ensureDocsApiScript(dsUrl, callback) {
    dsUrl = normalizeDsUrl(dsUrl);
    var sameDs = !pptDocsApiScriptDsUrl || pptDocsApiScriptDsUrl === dsUrl;
    if (sameDs && window.DocsAPI && window.DocsAPI.DocEditor) {
      callback(null);
      return;
    }
    if (sameDs && pptDocsApiScriptLoading) {
      pptDocsApiScriptWaiters.push(callback);
      return;
    }
    var existing = document.getElementById("onlyturgie-docs-api-script");
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
    if (!sameDs) {
      try {
        delete window.DocsAPI;
      } catch (eDel) {
        window.DocsAPI = undefined;
      }
    }
    function drain(err) {
      pptDocsApiScriptLoading = false;
      var list = pptDocsApiScriptWaiters.slice();
      pptDocsApiScriptWaiters = [];
      list.forEach(function (cb) {
        cb(err);
      });
    }
    var script = document.createElement("script");
    script.id = "onlyturgie-docs-api-script";
    script.src = dsUrl + "web-apps/apps/api/documents/api.js";
    script.async = true;
    pptDocsApiScriptDsUrl = dsUrl;
    pptDocsApiScriptLoading = true;
    pptDocsApiScriptWaiters.push(callback);
    script.onload = function () {
      drain(null);
    };
    script.onerror = function () {
      // Permet un nouvel essai au prochain chant (sinon le script en échec bloquerait tout).
      if (script.parentNode) script.parentNode.removeChild(script);
      pptDocsApiScriptDsUrl = "";
      drain(new Error("Chargement api.js ONLYOFFICE impossible"));
    };
    document.head.appendChild(script);
  }

  /** Précharge api.js dès l’ouverture du panneau (mode DocsAPI) pour ne pas le payer au premier chant. */
  function preloadDocsApiScript() {
    var panel = getPanelCfg();
    if (panel.pptUseOfficeViewer !== false) return;
    var ds = typeof panel.documentServerUrl === "string" ? panel.documentServerUrl.trim() : "";
    if (!ds) return;
    ensureDocsApiScript(ds, function () {
      /* erreurs gérées au premier vrai affichage */
    });
  }

  /**
   * pptUseOfficeViewer === false : aperçu via Document Server (DocEditor, view, slide).
   */
  function bindPptPaneViaDocsApi(emptyEl, iframe, fileUrl) {
    var trimmed = (fileUrl || "").trim();
    var editorHost = document.getElementById("oo-ppt-editor");
    if (!emptyEl || !iframe || !editorHost) return;

    if (!trimmed) {
      // Invalide un chargement en cours (sinon l’éditeur apparaîtrait sur un chant sans présentation).
      ++pptDocsApiLoadSeq;
      destroyPptDocEditor();
      pptDocsApiSourceUrl = "";
      pptDocsApiPhase = "";
      emptyEl.hidden = false;
      iframe.hidden = true;
      iframe.removeAttribute("src");
      return;
    }

    if (pptDocsApiSourceUrl === trimmed) {
      var since = Date.now() - pptDocsApiPhaseAt;
      if (pptDocsApiPhase === "loading" && since < PPT_LOADING_STALE_MS) return;
      if (pptDocsApiPhase === "ready" && pptDocEditor && !editorHost.hidden) return;
      if (pptDocsApiPhase === "error" && since < PANE_RETRY_AFTER_MS) return;
    }

    var loadSeq = ++pptDocsApiLoadSeq;
    pptDocsApiSourceUrl = trimmed;
    setPptDocsApiPhase("loading");
    function failPpt(message) {
      if (loadSeq !== pptDocsApiLoadSeq) return;
      destroyPptDocEditor();
      setPptDocsApiPhase("error");
      emptyEl.hidden = false;
      editorHost.hidden = true;
      emptyEl.textContent = message;
    }
    var fetchFn =
      window.LstjoRuntime && typeof window.LstjoRuntime.fetchLiturgie === "function"
        ? function (u) {
            return window.LstjoRuntime.fetchLiturgie(u);
          }
        : function (u) {
            return fetch(u, { method: "GET", credentials: "omit" });
          };

    emptyEl.hidden = false;
    iframe.hidden = true;
    iframe.removeAttribute("src");
    editorHost.hidden = true;
    destroyPptDocEditor();
    emptyEl.textContent = "Chargement présentation (ONLYOFFICE)…";

    var cfg = getLstjoConfig();
    var configUrl = buildPptOnlyOfficeConfigFetchUrl(trimmed, cfg);
    if (!configUrl) {
      failPpt("Présentation : apiBase liturgie manquant (paramètres hôte).");
      return;
    }

    fetchFn(configUrl)
      .then(function (response) {
        return response.text().then(function (body) {
          if (!response.ok) {
            throw new Error(liturgieHttpErrorMessage(response, body));
          }
          try {
            return JSON.parse(body);
          } catch (eJson) {
            throw new Error("Réponse panel-config non JSON : " + (body || "").trim().slice(0, 120));
          }
        });
      })
      .then(function (editorConfig) {
        if (loadSeq !== pptDocsApiLoadSeq) return;
        if (!editorConfig || typeof editorConfig !== "object") {
          throw new Error("Config ONLYOFFICE vide");
        }
        var dsUrl =
          typeof editorConfig.documentServerUrl === "string" && editorConfig.documentServerUrl.trim()
            ? editorConfig.documentServerUrl.trim().replace(/\/?$/, "/")
            : getDocumentServerUrlForPanel();
        ensureDocsApiScript(dsUrl, function (scriptErr) {
          if (loadSeq !== pptDocsApiLoadSeq) return;
          if (scriptErr) {
            failPpt("Présentation : " + scriptErr.message);
            return;
          }
          if (!window.DocsAPI || !window.DocsAPI.DocEditor) {
            failPpt("Présentation : DocsAPI indisponible.");
            return;
          }
          destroyPptDocEditor();
          editorHost.hidden = false;
          /*
           * DocsAPI remplace l’élément cible par son iframe (et en remet un nu au destroy) : on lui donne
           * une div enfant jetable, #oo-ppt-editor reste le conteneur stable (classe, hidden, getElementById).
           */
          editorHost.innerHTML = '<div id="' + PPT_EDITOR_FRAME_ID + '"></div>';
          /* emptyEl reste visible jusqu’à onDocumentReady (chargement DS + fichier). */
          attachPptDocEditorEvents(editorConfig, loadSeq, emptyEl, editorHost);
          try {
            pptDocEditor = new window.DocsAPI.DocEditor(PPT_EDITOR_FRAME_ID, editorConfig);
          } catch (eEditor) {
            failPpt("Présentation : " + String(eEditor && eEditor.message ? eEditor.message : eEditor));
          }
        });
      })
      .catch(function (err) {
        failPpt("Présentation : " + String(err && err.message ? err.message : err));
      });
  }

  function liturgieHttpErrorMessage(response, body) {
    var preview = (body || "").trim().slice(0, 160);
    var hint =
      response.status === 404
        ? " (route ou fichier introuvable ?)"
        : response.status === 403
          ? " (jeton ou droits API)"
          : response.status === 400
            ? " (paramètres invalides)"
            : "";
    try {
      var parsed = JSON.parse(body);
      if (parsed && typeof parsed.message === "string" && parsed.message.trim()) {
        return "HTTP " + response.status + hint + " — " + parsed.message.trim();
      }
    } catch (eParse) {
      /* ignore */
    }
    return "HTTP " + response.status + hint + (preview ? " — " + preview : "");
  }

  function attachPptDocEditorEvents(editorConfig, loadSeq, emptyEl, editorHost) {
    editorConfig.events = editorConfig.events || {};
    var prevReady = editorConfig.events.onDocumentReady;
    var prevError = editorConfig.events.onError;
    editorConfig.events.onDocumentReady = function () {
      if (loadSeq !== pptDocsApiLoadSeq) return;
      setPptDocsApiPhase("ready");
      emptyEl.hidden = true;
      if (typeof prevReady === "function") {
        prevReady.apply(this, arguments);
      }
    };
    editorConfig.events.onError = function (event) {
      if (loadSeq !== pptDocsApiLoadSeq) return;
      destroyPptDocEditor();
      setPptDocsApiPhase("error");
      editorHost.hidden = true;
      emptyEl.hidden = false;
      var data = event && event.data;
      var desc = data && typeof data.errorDescription === "string" ? data.errorDescription.trim() : "";
      var code = data && data.errorCode != null ? String(data.errorCode) : "";
      var detail = desc || (code ? "code " + code : "erreur Document Server");
      emptyEl.textContent = "Présentation ONLYOFFICE : " + detail;
      if (typeof prevError === "function") {
        prevError.apply(this, arguments);
      }
    };
  }

  /** Oublie le PDF affiché (le blob reste dans pdfBlobCache ; révoqué à l’éviction ou clearPanelCaches). */
  function revokePdfBlobUrl() {
    // Invalide aussi un téléchargement en cours (sinon il s’afficherait sur un chant sans PDF).
    ++pdfBlobLoadSeq;
    pdfBlobObjectUrl = "";
    pdfBlobSourceUrl = "";
  }

  function showPdfBlob(emptyEl, iframe, sourceUrl, objectUrl) {
    pdfBlobSourceUrl = sourceUrl;
    pdfBlobObjectUrl = objectUrl;
    emptyEl.hidden = true;
    iframe.hidden = false;
    if ((iframe.getAttribute("src") || "").trim() !== objectUrl) {
      iframe.setAttribute("src", objectUrl);
    }
  }

  /**
   * Firefox / Nextcloud refusent d’afficher cloud…/api/pdf/file dans une iframe cross-origin (X-Frame-Options).
   * fetch + blob: URL = même origine que le panneau plugin.
   */
  function bindPdfPaneViaBlob(emptyEl, iframe, fileUrl) {
    var trimmed = (fileUrl || "").trim();
    if (!trimmed) {
      revokePdfBlobUrl();
      emptyEl.hidden = false;
      iframe.hidden = true;
      iframe.removeAttribute("src");
      return;
    }
    if (pdfBlobSourceUrl === trimmed && pdfBlobObjectUrl && !iframe.hidden) {
      var cur = (iframe.getAttribute("src") || "").trim();
      if (cur === pdfBlobObjectUrl) return;
    }

    var cachedObjectUrl = pdfBlobCacheGet(trimmed);
    if (cachedObjectUrl) {
      ++pdfBlobLoadSeq;
      showPdfBlob(emptyEl, iframe, trimmed, cachedObjectUrl);
      return;
    }
    // Déjà en cours pour ce fichier : ne pas annuler / relancer (avant ++loadSeq, sinon le résultat serait ignoré).
    // (seulement si ce téléchargement est toujours le courant : sinon son résultat ne serait jamais affiché)
    if (pdfBlobPendingUrl === trimmed && pdfBlobPendingSeq === pdfBlobLoadSeq) return;
    // Échec récent : garder le message, retenter seulement après PANE_RETRY_AFTER_MS.
    if (pdfBlobFailedUrl === trimmed && Date.now() - pdfBlobFailedAt < PANE_RETRY_AFTER_MS) return;

    var loadSeq = ++pdfBlobLoadSeq;
    pdfBlobPendingUrl = trimmed;
    pdfBlobPendingSeq = loadSeq;
    var fetchFn =
      window.LstjoRuntime && typeof window.LstjoRuntime.fetchLiturgie === "function"
        ? function (u) {
            return window.LstjoRuntime.fetchLiturgie(u);
          }
        : function (u) {
            return fetch(u, { method: "GET", credentials: "omit" });
          };

    emptyEl.hidden = false;
    iframe.hidden = true;
    emptyEl.textContent = "Chargement PDF…";

    fetchFn(trimmed)
      .then(function (response) {
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }
        return response.blob();
      })
      .then(function (blob) {
        if (pdfBlobPendingUrl === trimmed) pdfBlobPendingUrl = "";
        if (pdfBlobFailedUrl === trimmed) pdfBlobFailedUrl = "";
        // Même si l’utilisateur est passé à un autre chant, on garde le PDF en cache pour un retour rapide.
        var objectUrl = pdfBlobCacheGet(trimmed);
        if (!objectUrl) {
          objectUrl = URL.createObjectURL(blob);
          pdfBlobCachePut(trimmed, objectUrl);
        }
        if (loadSeq !== pdfBlobLoadSeq) return;
        showPdfBlob(emptyEl, iframe, trimmed, objectUrl);
      })
      .catch(function (err) {
        if (pdfBlobPendingUrl === trimmed) pdfBlobPendingUrl = "";
        pdfBlobFailedUrl = trimmed;
        pdfBlobFailedAt = Date.now();
        if (loadSeq !== pdfBlobLoadSeq) return;
        revokePdfBlobUrl();
        emptyEl.hidden = false;
        iframe.hidden = true;
        iframe.removeAttribute("src");
        emptyEl.textContent =
          "PDF : " + String(err && err.message ? err.message : err) + " (CORS / jeton / fichier ?)";
      });
  }

  function bindPane(kind, url, resolveSrc) {
    var emptyEl = document.getElementById("empty-" + kind);
    var iframe = document.getElementById("iframe-" + kind);
    if (!emptyEl || !iframe) return;

    if (kind === "ppt" && getPanelCfg().pptUseOfficeViewer === false) {
      bindPptPaneViaDocsApi(emptyEl, iframe, url);
      return;
    }

    if (kind === "ppt") {
      destroyPptDocEditor();
      pptDocsApiSourceUrl = "";
      pptDocsApiLoadSeq++;
    }

    var src = (resolveSrc || function (u) {
      return (u || "").trim();
    })(url);

    if (kind === "pdf" && src && /^https?:\/\//i.test(src)) {
      bindPdfPaneViaBlob(emptyEl, iframe, src);
      return;
    }

    if (kind === "pdf" && !src) {
      revokePdfBlobUrl();
    }

    if (!src) {
      emptyEl.hidden = false;
      iframe.hidden = true;
      iframe.removeAttribute("src");
      return;
    }

    var currentSrc = (iframe.getAttribute("src") || "").trim();
    if (!iframe.hidden && currentSrc === src) {
      return;
    }

    emptyEl.hidden = true;
    iframe.hidden = false;
    iframe.setAttribute("src", src);
  }

  function setEmptyMessage(kind, text) {
    var emptyEl = document.getElementById("empty-" + kind);
    if (emptyEl) emptyEl.textContent = text;
  }

  function getSentenceText(callback) {
    window.Asc.plugin.executeMethod("GetCurrentSentence", ["entirely"], function (sentence) {
      callback((sentence || "").trim());
    });
  }

  function getSelectedTextLine(callback) {
    window.Asc.plugin.executeMethod(
      "GetSelectedText",
      [
        {
          Numbering: false,
          Math: false,
          TableCellSeparator: "\n",
          ParaSeparator: "\n",
          TabSymbol: "\t",
        },
      ],
      function (text) {
        callback(compactLineText(text));
      }
    );
  }

  function getCursorText(callback) {
    var cfg = getLstjoConfig();
    var panel = (cfg && cfg.panel) || {};
    var lineMode = panel.lineMode || "paragraph";
    var et = window.Asc.plugin.info && window.Asc.plugin.info.editorType;

    if (lineMode === "sentence" || et !== "word") {
      getSentenceText(callback);
      return;
    }

    window.LstjoRuntime.readCursorCellContext(function (ctx) {
        var raw = String(ctx.text || "").trim();
        var left = ctx.left || "";
        window.LstjoRuntime.publishCursorCellHint(window.LstjoRuntime.isDiapoCellLabel(left));
        if (raw && window.LstjoRuntime.isDiapoCellLabel(left)) {
          callback(raw, left);
          return;
        }
        if (!raw) {
          getSelectedTextLine(function (sel) {
            if (sel) {
              callback(sel);
              return;
            }
            getSentenceText(callback);
          });
          return;
        }
        if (lineMode === "firstLine") {
          var lines = raw.split(/\r?\n/);
          callback((lines[0] || "").trim());
        } else {
          callback(raw);
        }
    });
  }

  function setStatus(text) {
    if (chantStatusEl) chantStatusEl.textContent = text || "";
  }

  function syncCredentialsBar() {
    if (!credentialsBarEl) return;
    var missing =
      window.LstjoRuntime && typeof window.LstjoRuntime.hasApiCredentials === "function"
        ? !window.LstjoRuntime.hasApiCredentials()
        : false;
    credentialsBarEl.hidden = !missing;
  }

  function openSettingsFromPanel() {
    if (!window.LstjoRuntime || typeof window.LstjoRuntime.openOnlyturgieSettingsWindow !== "function") {
      return;
    }
    window.LstjoRuntime.openOnlyturgieSettingsWindow({
      onClose: function () {
        if (window.LstjoRuntime && typeof window.LstjoRuntime.syncFromEditorBridge === "function") {
          window.LstjoRuntime.syncFromEditorBridge();
        }
        loadChantList(getLstjoConfig())
          .then(function (list) {
            chantList = list;
            resolveUrlsForPanels();
          })
          .catch(function () {
            resolveUrlsForPanels();
          });
      },
    });
  }

  function compactLineText(s) {
    return String(s || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** Barre du haut : texte de la ligne (ou chant) — pas le message « aucun chant » (réservé aux volets PDF/PPT). */
  function buildPanelStatusText(lineText, chant, opts) {
    opts = opts || {};
    var line = compactLineText(lineText);
    if (chant) {
      var label = opts.diapo ? "Diapo : " : "Chant : ";
      return line && !opts.diapo ? line + " — " + label + chant : label + chant;
    }
    if (line) {
      return opts.chantListEmpty
        ? line + " (liste vide — vérifiez la source dans lstjo.panel.)"
        : line;
    }
    return "Placez le curseur sur une ligne dont le nom d’un chant est dans la liste.";
  }

  function buildResolveKey(lineText, chant) {
    if (chant) {
      return normalizeForMatch(chant);
    }
    return "\x1e" + normalizeForMatch(lineText);
  }

  function applySettledResolve(snapshot) {
    if (!snapshot) return;
    if (snapshot.statusText) setStatus(snapshot.statusText);
    if (snapshot.pdfEmptyMsg) setEmptyMessage("pdf", snapshot.pdfEmptyMsg);
    if (snapshot.pptEmptyMsg) setEmptyMessage("ppt", snapshot.pptEmptyMsg);
    syncPanelResolveStateToUi(snapshot, getPanelCfg().pptUseOfficeViewer !== false);
    bindPane("pdf", snapshot.pdfUrl || "");
    bindPane("ppt", snapshot.pptUrl || "", function (u) {
      return resolvePptIframeSrc(u, getPanelCfg().pptUseOfficeViewer !== false);
    });
  }

  function resolveUrlsForPanels() {
    if (window.LstjoRuntime && typeof window.LstjoRuntime.syncFromEditorBridge === "function") {
      window.LstjoRuntime.syncFromEditorBridge();
    }
    syncCredentialsBar();
    var cfg = getLstjoConfig();
    var panel = (cfg && cfg.panel) || {};
    var pptUseOfficeViewer = panel.pptUseOfficeViewer !== false;
    var pdfTpl = typeof panel.pdfUrlTemplate === "string" ? panel.pdfUrlTemplate.trim() : "";
    var pptTpl = typeof panel.pptUrlTemplate === "string" ? panel.pptUrlTemplate.trim() : "";
    var pdfApiTpl = "";
    var pptApiTpl = "";
    if (window.LstjoRuntime && typeof window.LstjoRuntime.resolvePanelApiTemplate === "function") {
      pdfApiTpl = window.LstjoRuntime.resolvePanelApiTemplate(cfg, "pdfApiUrlTemplate");
      pptApiTpl = window.LstjoRuntime.resolvePanelApiTemplate(cfg, "pptApiUrlTemplate");
    } else {
      pdfApiTpl = typeof panel.pdfApiUrlTemplate === "string" ? panel.pdfApiUrlTemplate.trim() : "";
      pptApiTpl = typeof panel.pptApiUrlTemplate === "string" ? panel.pptApiUrlTemplate.trim() : "";
    }
    var sourceId = typeof panel.sourceId === "string" && panel.sourceId ? panel.sourceId : "chant";
    var chantsSourceUrl = resolveChantsSourceUrl(cfg, sourceId);
    if (window.LstjoRuntime && !window.LstjoRuntime.hasApiCredentials()) {
      setStatus(
        window.LstjoRuntime.getCredentialsStatusMessage
          ? window.LstjoRuntime.getCredentialsStatusMessage()
          : "Renseignez l’hôte et le jeton via le bouton Paramètres ci-dessous."
      );
    }
    // Si les templates PDF/PPT ne sont pas renseignés mais que l'URL du catalogue (ex. /api/chant) est connue,
    // on les reconstruit automatiquement via le même token.
    if (!pdfApiTpl) {
      pdfApiTpl =
        window.LstjoRuntime && window.LstjoRuntime.inferPanelApiUrlTemplateFromCatalogUrl
          ? window.LstjoRuntime.inferPanelApiUrlTemplateFromCatalogUrl(chantsSourceUrl, "pdf", cfg)
          : inferApiUrlTemplateFromChantsUrl(chantsSourceUrl, "pdf");
    }
    if (!pptApiTpl) {
      pptApiTpl =
        window.LstjoRuntime && window.LstjoRuntime.inferPanelApiUrlTemplateFromCatalogUrl
          ? window.LstjoRuntime.inferPanelApiUrlTemplateFromCatalogUrl(chantsSourceUrl, "ppt", cfg)
          : inferApiUrlTemplateFromChantsUrl(chantsSourceUrl, "ppt");
    }
    var jsonUrlKey =
      typeof panel.apiJsonUrlKey === "string" && panel.apiJsonUrlKey.trim()
        ? panel.apiJsonUrlKey.trim()
        : "url";
    var staticPdf = typeof panel.pdfUrl === "string" ? panel.pdfUrl.trim() : "";
    var staticPpt = typeof panel.pptUrl === "string" ? panel.pptUrl.trim() : "";

    var useDirectTemplates = !!(pdfTpl || pptTpl);
    var useApiTemplates = !!(pdfApiTpl || pptApiTpl);

    if (!useDirectTemplates && !useApiTemplates) {
      setStatus("");
      setEmptyMessage(
        "pdf",
        "Aucune URL : renseignez lstjo.panel.pdfUrl, pdfApiUrlTemplate, ou pdfUrlTemplate (placeholders: {chant}, {encoded}, {slug}, {base64}, {base64url})."
      );
      setEmptyMessage(
        "ppt",
        "Aucune URL : renseignez lstjo.panel.pptUrl, pptApiUrlTemplate, ou pptUrlTemplate (placeholders: {chant}, {encoded}, {slug}, {base64}, {base64url})."
      );
      bindPane("pdf", staticPdf);
      bindPane("ppt", staticPpt, function (u) {
        return resolvePptIframeSrc(u, pptUseOfficeViewer);
      });
      return;
    }

    var cursorId = ++pendingCursorResolveId;

    getCursorText(function (lineText, leftText) {
      if (cursorId !== pendingCursorResolveId) return;

      // « Diapo » dans la cellule de gauche : le texte est un nom de diapo (dossier ou .ppt/.pptx direct
      // sous le dossier diapos), pas un chant du catalogue — présentation seule, via scope=diapo.
      var diapoMode = !!(leftText && window.LstjoRuntime.isDiapoCellLabel(leftText) && String(lineText || "").trim());
      var chantMatch = panel.chantMatch === "contains" ? "contains" : "exact";
      var chant = diapoMode ? String(lineText).trim() : findMatchingChant(lineText, chantList, chantMatch);
      if (diapoMode) {
        pptApiTpl = window.LstjoRuntime.withDocumentContext(window.LstjoRuntime.withDiapoScope(pptApiTpl));
        pdfApiTpl = "";
        pdfTpl = "";
        pptTpl = "";
      }

      if (!chant) {
        var noChantKey = buildResolveKey(lineText, "");
        if (noChantKey === lastSettledResolveKey && lastSettledResolve && lastSettledResolve.noChant) {
          applySettledResolve(lastSettledResolve);
          return;
        }
        var noChantStatus = buildPanelStatusText(lineText, null, { chantListEmpty: !chantList.length });
        setStatus(noChantStatus);
        setEmptyMessage("pdf", "Aucun chant reconnu sur cette ligne.");
        setEmptyMessage("ppt", "Aucun chant reconnu sur cette ligne.");
        bindPane("pdf", "");
        bindPane("ppt", "");
        lastSettledResolveKey = noChantKey;
        lastSettledResolve = {
          noChant: true,
          statusText: noChantStatus,
          pdfUrl: "",
          pptUrl: "",
          pdfPathFull: "",
          pptPathFull: "",
          pdfFiles: [],
          pptFiles: [],
          pdfEmptyMsg: "Aucun chant reconnu sur cette ligne.",
          pptEmptyMsg: "Aucun chant reconnu sur cette ligne.",
        };
        syncPanelResolveStateToUi(lastSettledResolve, pptUseOfficeViewer);
        return;
      }

      var resolveKey =
        (diapoMode ? "diapo|" + (window.LstjoRuntime.getDocumentContext().key || "") + "|" : "") +
        buildResolveKey(lineText, chant);
      if (resolveKey === lastSettledResolveKey && lastSettledResolve && !lastSettledResolve.noChant) {
        applySettledResolve(lastSettledResolve);
        return;
      }
      if (inFlightChantFetch && inFlightChantFetch.key === resolveKey) {
        return;
      }

      var cachedSnapshot = resolveCacheGet(resolveKey);
      if (cachedSnapshot) {
        ++resolveSeq;
        inFlightChantFetch = null;
        var fromCache = {};
        Object.keys(cachedSnapshot).forEach(function (k) {
          fromCache[k] = cachedSnapshot[k];
        });
        fromCache.statusText = buildPanelStatusText(lineText, chant, { diapo: diapoMode });
        lastSettledResolveKey = resolveKey;
        lastSettledResolve = fromCache;
        applySettledResolve(fromCache);
        return;
      }

      var mySeq = ++resolveSeq;

      setStatus(buildPanelStatusText(lineText, chant, { diapo: diapoMode }));
      panelResolveState.chantKey = resolveKey;

      var needPdfApi = !!pdfApiTpl;
      var needPptApi = !!pptApiTpl;
      var needPdfDirect = !!pdfTpl && !pdfApiTpl;
      var needPptDirect = !!pptTpl && !pptApiTpl;

      if (needPdfApi) setEmptyMessage("pdf", "Chargement (API)…");
      else if (needPdfDirect) setEmptyMessage("pdf", "Chargement…");
      if (needPptApi) setEmptyMessage("ppt", "Chargement (API)…");
      else if (needPptDirect) setEmptyMessage("ppt", "Chargement…");

      var emptyResult = { url: "", path_full: "", files: [], error: "" };

      function startKind(kind, needApi, needDirect, apiTpl, directTpl) {
        if (needApi) return fetchPanelAsset(kind, chant, apiTpl, cfg, jsonUrlKey);
        if (needDirect) {
          return Promise.resolve({ url: applyUrlTemplate(directTpl, chant), path_full: "", files: [], error: "" });
        }
        return Promise.resolve(emptyResult);
      }

      /** Calcule l’état d’un volet (fichier choisi, message d’erreur) à partir du résultat API. */
      function buildKindOutcome(kind, result, needApi, needDirect) {
        result = result || emptyResult;
        var files = dedupePanelFiles(result.files || []);
        var idx = pickDefaultFileIndex(files, chant, kind);
        var pick = files[idx] || { url: result.url, path_full: result.path_full };
        var url = pick.url || result.url || "";
        var pathFull = pick.path_full || result.path_full || "";
        var emptyMsg = "";
        if (!url && diapoMode) {
          emptyMsg =
            kind === "pdf"
              ? "Diapo : pas de PDF."
              : result.error
                ? "Diapo : " + result.error
                : "Diapo introuvable (.ppt/.pptx ou dossier dans le dossier diapos).";
        } else if (!url) {
          if (kind === "pdf") {
            emptyMsg = needApi
              ? result.error
                ? "API PDF : " + result.error
                : "API PDF : échec (vérifiez Onlyturgie — paramètres, jeton, ou fichier dans le dossier chant)."
              : needDirect
                ? "URL PDF vide (modèle)."
                : "PDF non configuré (pdfApiUrlTemplate / pdfUrlTemplate vides).";
          } else {
            emptyMsg = needApi
              ? result.error
                ? "API présentation : " + result.error
                : "API présentation : échec (vérifiez paramètres ou .ppt/.pptx dans le dossier chant)."
              : needDirect
                ? "URL présentation vide (modèle)."
                : "Présentation non configurée (pptApiUrlTemplate / pptUrlTemplate vides).";
          }
        }
        // Erreur transitoire (réseau, 5xx…) : ne pas la garder en cache.
        var cacheable = !result.error || !!result.definitive;
        return { url: url, pathFull: pathFull, files: files, idx: idx, emptyMsg: emptyMsg, cacheable: cacheable };
      }

      /** Affiche un volet dès que son résultat arrive, sans attendre l’autre. */
      function applyKindOutcome(kind, o) {
        if (mySeq !== resolveSeq) return;
        if (o.emptyMsg) setEmptyMessage(kind, o.emptyMsg);
        if (kind === "pdf") {
          panelResolveState.pdfFiles = o.files;
          panelResolveState.pdfIndex = o.idx;
          panelResolveState.pdfPathFull = o.pathFull;
          updateFilePickerUi("pdf", o.files, o.idx, chant);
          bindPane("pdf", o.url);
        } else {
          panelResolveState.pptFiles = o.files;
          panelResolveState.pptIndex = o.idx;
          panelResolveState.pptPathFull = o.pathFull;
          updateFilePickerUi("ppt", o.files, o.idx, chant);
          bindPane("ppt", o.url, function (u) {
            return resolvePptIframeSrc(u, pptUseOfficeViewer);
          });
        }
      }

      var pdfPromise = startKind("pdf", needPdfApi, needPdfDirect, pdfApiTpl, pdfTpl).then(function (r) {
        var o = buildKindOutcome("pdf", r, needPdfApi, needPdfDirect);
        applyKindOutcome("pdf", o);
        return o;
      });
      var pptPromise = startKind("ppt", needPptApi, needPptDirect, pptApiTpl, pptTpl).then(function (r) {
        var o = buildKindOutcome("ppt", r, needPptApi, needPptDirect);
        applyKindOutcome("ppt", o);
        return o;
      });

      var fetchAll = Promise.all([pdfPromise, pptPromise]);
      inFlightChantFetch = { key: resolveKey, promise: fetchAll };

      fetchAll
        .then(function (pair) {
          if (inFlightChantFetch && inFlightChantFetch.promise === fetchAll) {
            inFlightChantFetch = null;
          }
          var pdfO = pair[0];
          var pptO = pair[1];
          // Fichier choisi dans un menu pendant que l’autre volet chargeait : le conserver.
          if (mySeq === resolveSeq && panelResolveState.chantKey === resolveKey) {
            [["pdf", pdfO], ["ppt", pptO]].forEach(function (pair2) {
              var k = pair2[0];
              var o = pair2[1];
              var sel = panelResolveState[k + "Index"];
              if (o.files.length > 1 && typeof sel === "number" && sel !== o.idx && o.files[sel]) {
                o.idx = sel;
                o.url = o.files[sel].url || o.url;
                o.pathFull = o.files[sel].path_full || o.pathFull;
              }
            });
          }
          var snapshot = {
            noChant: false,
            statusText: buildPanelStatusText(lineText, chant, { diapo: diapoMode }),
            chant: chant,
            chantKey: resolveKey,
            pdfUrl: pdfO.url,
            pptUrl: pptO.url,
            pdfPathFull: pdfO.pathFull,
            pptPathFull: pptO.pathFull,
            pdfFiles: pdfO.files,
            pptFiles: pptO.files,
            pdfIndex: pdfO.idx,
            pptIndex: pptO.idx,
            pdfEmptyMsg: pdfO.emptyMsg,
            pptEmptyMsg: pptO.emptyMsg,
          };
          if (pdfO.cacheable && pptO.cacheable) {
            resolveCachePut(resolveKey, snapshot);
          }
          if (mySeq !== resolveSeq) return;
          lastSettledResolveKey = resolveKey;
          lastSettledResolve = snapshot;
        })
        .catch(function () {
          if (inFlightChantFetch && inFlightChantFetch.promise === fetchAll) {
            inFlightChantFetch = null;
          }
        });
    });
  }

  function scheduleRefresh() {
    var panel = getPanelCfg();
    var ms = typeof panel.refreshDebounceMs === "number" && panel.refreshDebounceMs >= 0 ? panel.refreshDebounceMs : 200;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      debounceTimer = null;
      resolveUrlsForPanels();
    }, ms);
  }

  /**
   * Ratio PDF / (PDF + Présentation) dans la zone entre la barre de statut et le bas du panneau.
   * Grille CSS « fr » (comme l’ancien 7fr/3fr) : fonctionne aussi panneau vide — indépendant des iframes.
   * Séparateur horizontal draggable ; valeur persistée (localStorage).
   */
  function initSplitGutter() {
    var wrap = document.getElementById("split-wrap");
    var gutter = document.getElementById("split-gutter");
    if (!wrap || !gutter) return;

    function gutterTrack() {
      var h = gutter.offsetHeight;
      return (h && h > 0 ? h + "px" : "6px");
    }

    function applyRatio(r, persist) {
      if (typeof r !== "number" || isNaN(r)) r = DEFAULT_PDF_RATIO;
      r = Math.max(MIN_PDF_RATIO, Math.min(MAX_PDF_RATIO, r));
      var a = r * 100;
      var b = (1 - r) * 100;
      wrap.style.gridTemplateRows = "minmax(0," + a + "fr) " + gutterTrack() + " minmax(0," + b + "fr)";
      if (persist !== false) {
        try {
          localStorage.setItem(STORAGE_PDF_RATIO_KEY, String(r));
        } catch (e) {
          /* ignore */
        }
      }
    }

    splitApplyRatioFn = function (ratio) {
      applyRatio(ratio, false);
    };

    applyRatio(DEFAULT_PDF_RATIO, false);

    try {
      var raw = localStorage.getItem(STORAGE_PDF_RATIO_KEY);
      if (raw !== null && raw !== "") {
        var saved = parseFloat(raw);
        if (!isNaN(saved)) applyRatio(saved, false);
      }
    } catch (eLoad) {
      /* ignore */
    }

    var dragging = false;

    function ratioFromClientY(clientY) {
      var rect = wrap.getBoundingClientRect();
      var gh = gutter.offsetHeight || 6;
      var denom = rect.height - gh;
      if (denom <= 0) return DEFAULT_PDF_RATIO;
      var y = clientY - rect.top;
      return y / denom;
    }

    function onMove(e) {
      if (!dragging) return;
      var y =
        typeof e.clientY === "number"
          ? e.clientY
          : e.touches && e.touches[0]
            ? e.touches[0].clientY
            : 0;
      applyRatio(ratioFromClientY(y), true);
      e.preventDefault();
    }

    function endDrag() {
      if (!dragging) return;
      dragging = false;
      gutter.classList.remove("is-dragging");
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", endDrag);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", endDrag);
      document.removeEventListener("touchcancel", endDrag);
    }

    gutter.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      dragging = true;
      gutter.classList.add("is-dragging");
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", endDrag);
    });

    gutter.addEventListener(
      "touchstart",
      function (e) {
        if (e.touches.length !== 1) return;
        e.preventDefault();
        dragging = true;
        gutter.classList.add("is-dragging");
        document.addEventListener("touchmove", onMove, { passive: false });
        document.addEventListener("touchend", endDrag);
        document.addEventListener("touchcancel", endDrag);
      },
      { passive: false }
    );
  }

  function onPanelSettingsSaved() {
    if (window.LstjoRuntime && typeof window.LstjoRuntime.syncFromEditorBridge === "function") {
      window.LstjoRuntime.syncFromEditorBridge();
    }
    lastSettledResolveKey = "";
    lastSettledResolve = null;
    inFlightChantFetch = null;
    pdfBlobLoadSeq++;
    clearPanelCaches();
    pptDocsApiLoadSeq++;
    destroyPptDocEditor();
    pptDocsApiSourceUrl = "";
    var cfg = getLstjoConfig();
    loadChantList(cfg)
      .then(function (list) {
        chantList = list;
        scheduleRefresh();
      })
      .catch(function () {
        scheduleRefresh();
      });
  }

  // ------------------------------------------------------------------
  // Pied du panneau : actions sur le document ouvert (app Nextcloud liturgie)
  // ------------------------------------------------------------------

  var MENU_ACTIONS = {
    partitions: { label: "Récupérer les partitions", path: "/menu/partitions" },
    playlist: { label: "Générer playlist", path: "/menu/playlist" },
    diaporama: { label: "Générer diaporama", path: "/menu/diaporama" },
  };
  var menuActionBusy = false;
  var documentSnapshotWaiters = {};
  var documentSnapshotSeq = 0;

  function onDocumentSnapshot(data) {
    if (!data || !data.reqId || !documentSnapshotWaiters[data.reqId]) return;
    documentSnapshotWaiters[data.reqId](data);
  }

  /**
   * Le panneau est une fenêtre enfant : le background (qui a Asc.plugin.info et callCommand) lit le
   * document et renvoie le résultat. Secours direct si le background ne répond pas.
   */
  function requestDocumentSnapshot() {
    return new Promise(function (resolve) {
      var reqId = "doc" + ++documentSnapshotSeq + "_" + Date.now();
      var settled = false;
      function finish(snapshot) {
        if (settled) return;
        settled = true;
        delete documentSnapshotWaiters[reqId];
        resolve(snapshot || { lines: [], key: "", callbackUrl: "" });
      }
      documentSnapshotWaiters[reqId] = finish;
      var relayed = false;
      try {
        if (window.Asc && window.Asc.plugin && typeof window.Asc.plugin.sendToPlugin === "function") {
          window.Asc.plugin.sendToPlugin("onlyturgie.collectDocument", { reqId: reqId });
          relayed = true;
        }
      } catch (eSend) {
        relayed = false;
      }
      setTimeout(
        function () {
          if (settled) return;
          if (window.LstjoRuntime && typeof window.LstjoRuntime.collectDocumentSnapshot === "function") {
            window.LstjoRuntime.collectDocumentSnapshot(finish);
          } else {
            finish(null);
          }
        },
        relayed ? 5000 : 0
      );
    });
  }

  /** Chants et diapos cités dans le document, dans l’ordre d’apparition (répétitions comprises). */
  function findChantsInDocument(lines, list) {
    var panel = (getLstjoConfig() && getLstjoConfig().panel) || {};
    var mode = panel.chantMatch === "contains" ? "contains" : "exact";
    var found = [];
    (lines || []).forEach(function (line) {
      var candidates = [line];
      line.split("\t").forEach(function (seg) {
        candidates.push(seg);
      });
      var colon = line.indexOf(":");
      if (colon !== -1) candidates.push(line.slice(colon + 1));
      for (var i = 0; i < candidates.length; i++) {
        var chant = findMatchingChant(candidates[i], list, mode);
        if (chant) {
          found.push(chant); // doublons conservés (ex. « Bienvenue » au début et à la fin)
          return;
        }
      }
    });
    return found;
  }

  function joinNames(list, max) {
    list = list || [];
    max = max || 4;
    var shown = list.slice(0, max).join(", ");
    return list.length > max ? shown + "… (+" + (list.length - max) + ")" : shown;
  }

  function describeMenuActionResult(action, data) {
    var parts = [];
    if (action === "partitions") {
      parts.push(
        "Partitions : " +
          (data.copied || []).length +
          " copiée(s), " +
          (data.unchanged || []).length +
          " déjà à jour → " +
          (data.folder || "Partitions")
      );
    } else if (action === "playlist") {
      parts.push("Playlist : " + (data.items || []).length + " présentation(s) → " + (data.file || "liste_diapos.playlist.txt"));
    } else {
      parts.push(
        "Diaporama : " +
          (data.slides || 0) +
          " diapositive(s) de " +
          (data.sources || []).length +
          " présentation(s) → " +
          (data.file || "")
      );
      if ((data.notPptx || []).length) parts.push("Ignorés (.ppt) : " + joinNames(data.notPptx));
      if ((data.unreadable || []).length) parts.push("Illisibles : " + joinNames(data.unreadable));
    }
    if ((data.missing || []).length) {
      parts.push((action === "partitions" ? "Sans PDF : " : "Sans présentation : ") + joinNames(data.missing));
    }
    return parts.join(" — ");
  }

  // --- Popup de résultat -------------------------------------------------

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /** items : [{ text, cls }] ; cls = result-ok (vert) | result-info (bleu) | result-error (rouge) */
  function resultSection(body, title, items, emptyText) {
    body.appendChild(el("div", "result-section-title", title + " (" + items.length + ")"));
    if (!items.length) {
      body.appendChild(el("div", "result-empty", emptyText || "Aucun"));
      return;
    }
    var ul = el("ul", "result-list");
    items.forEach(function (it) {
      ul.appendChild(el("li", it.cls, it.text));
    });
    body.appendChild(ul);
  }

  function tagged(list, cls) {
    return (list || []).map(function (t) {
      return { text: t, cls: cls };
    });
  }

  function closeResultPopup() {
    var overlay = document.getElementById("result-overlay");
    if (overlay) overlay.hidden = true;
  }

  function showResultPopup(action, data, errorMessage) {
    var overlay = document.getElementById("result-overlay");
    var body = document.getElementById("result-body");
    var title = document.getElementById("result-title");
    if (!overlay || !body || !title) return;
    var def = MENU_ACTIONS[action] || { label: "Résultat" };
    title.textContent = def.label;
    body.textContent = "";
    data = data || {};

    if (errorMessage) {
      var ul = el("ul", "result-list");
      ul.appendChild(el("li", "result-error", errorMessage));
      body.appendChild(ul);
    } else if (action === "partitions") {
      body.appendChild(el("p", "result-summary", "Dossier : " + (data.folder || "Partitions")));
      resultSection(body, "Partitions copiées", tagged(data.copied, "result-ok"), "Aucune nouvelle partition");
      resultSection(body, "Déjà présentes", tagged(data.unchanged, "result-info"));
      resultSection(body, "Dossiers sans partition", tagged(data.missing, "result-error"));
    } else if (action === "playlist") {
      body.appendChild(el("p", "result-summary", "Fichier : " + (data.file || "liste_diapos.playlist.txt") + " (ANSI)"));
      body.appendChild(el("div", "result-section-title", "Aperçu (" + (data.lines || []).length + " ligne(s))"));
      body.appendChild(el("pre", "result-file", (data.lines || []).join("\n") || "(vide)"));
      resultSection(body, "Chants sans .ppt (non inclus)", tagged(data.missing, "result-error"));
    } else {
      body.appendChild(
        el("p", "result-summary", "Fichier : " + (data.file || "") + " — " + (data.slides || 0) + " diapositive(s)")
      );
      var unreadable = data.unreadable || [];
      var integrated = (data.sources || []).filter(function (s) {
        return unreadable.indexOf(s) === -1;
      });
      resultSection(body, ".pptx intégrés", tagged(integrated, "result-ok"), "Aucun");
      if (unreadable.length) {
        resultSection(body, ".pptx illisibles (non intégrés)", tagged(unreadable, "result-error"));
      }
      resultSection(body, "Dossiers sans .pptx", tagged(data.missing, "result-error"));
    }
    overlay.hidden = false;
    var closeBtn = document.getElementById("result-close");
    if (closeBtn) closeBtn.focus();
  }

  function initResultPopup() {
    var overlay = document.getElementById("result-overlay");
    var closeBtn = document.getElementById("result-close");
    if (closeBtn) closeBtn.addEventListener("click", closeResultPopup);
    if (overlay) {
      overlay.addEventListener("click", function (e) {
        if (e.target === overlay) closeResultPopup();
      });
    }
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeResultPopup();
    });
  }

  /** Catalogue des diapos (« Diapos » du docx + Visionneuse/Commun) ; [] si indisponible. */
  function loadDiapoCatalogForDocument(cfg, snapshot) {
    var url = "";
    if (window.LstjoRuntime && typeof window.LstjoRuntime.resolveSourceUrl === "function") {
      url = window.LstjoRuntime.resolveSourceUrl("diapo", cfg) || "";
    }
    if (!url) return Promise.resolve([]);
    var extra = [];
    if (snapshot.key && !/[?&]key=/.test(url)) extra.push("key=" + encodeURIComponent(snapshot.key));
    if (snapshot.callbackUrl && !/[?&]callbackUrl=/.test(url)) {
      extra.push("callbackUrl=" + encodeURIComponent(snapshot.callbackUrl));
    }
    if (extra.length) url += (url.indexOf("?") === -1 ? "?" : "&") + extra.join("&");
    var request =
      window.LstjoRuntime && window.LstjoRuntime.fetchLiturgie
        ? window.LstjoRuntime.fetchLiturgie(url, {}, cfg)
        : fetch(url, { method: "GET", credentials: "omit" });
    return request
      .then(function (response) {
        return response.ok ? response.json() : [];
      })
      .then(function (payload) {
        return normalizeData(payload).filter(Boolean).map(function (s) {
          return String(s).trim();
        });
      })
      .catch(function () {
        return [];
      });
  }

  function setMenuActionsBusy(busy, activeBtn) {
    menuActionBusy = busy;
    var buttons = document.querySelectorAll("#panel-footer .panel-footer-btn");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].disabled = busy;
      buttons[i].classList.toggle("is-busy", busy && buttons[i] === activeBtn);
    }
  }

  function runMenuAction(action, btn) {
    var def = MENU_ACTIONS[action];
    if (!def || menuActionBusy) return;
    var cfg = getLstjoConfig();
    var apiBase =
      window.LstjoRuntime && typeof window.LstjoRuntime.getApiBase === "function"
        ? window.LstjoRuntime.getApiBase(cfg)
        : "";
    if (!apiBase) {
      setStatus(def.label + " : hôte de l’API liturgie manquant (Paramètres).");
      return;
    }
    setMenuActionsBusy(true, btn);
    setStatus(def.label + " : lecture du document…");

    var listPromise = chantList.length
      ? Promise.resolve(chantList)
      : loadChantList(cfg, { reportStatus: false }).then(function (l) {
          chantList = l;
          return l;
        });

    Promise.all([listPromise, requestDocumentSnapshot()])
      .then(function (pair) {
        var snapshot = pair[1] || {};
        return loadDiapoCatalogForDocument(cfg, snapshot).then(function (diapoList) {
          return { snapshot: snapshot, chantCatalog: pair[0] || [], diapoList: diapoList };
        });
      })
      .then(function (ctx) {
        var snapshot = ctx.snapshot;
        // Catalogue fusionné : un nom présent dans les deux reste un chant (partition) ; les diapos en plus.
        var merged = (ctx.chantCatalog || []).slice();
        ctx.diapoList.forEach(function (d) {
          if (merged.indexOf(d) === -1) merged.push(d);
        });
        var chants = findChantsInDocument(snapshot.lines, merged);
        var diapos = chants.filter(function (c) {
          return ctx.diapoList.indexOf(c) !== -1 && (ctx.chantCatalog || []).indexOf(c) === -1;
        });
        if (!chants.length) {
          throw new Error("aucun chant du catalogue n’est cité dans le document.");
        }
        if (!snapshot.key && !snapshot.callbackUrl) {
          throw new Error("identité du document indisponible (document hors Nextcloud ?).");
        }
        setStatus(def.label + " : " + chants.length + " chant(s) cité(s), traitement…");
        var url = ensureTokenOnApiUrl(apiBase + def.path, cfg);
        var init = {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            key: snapshot.key,
            callbackUrl: snapshot.callbackUrl,
            chants: chants,
            diapos: diapos,
          }),
        };
        var request =
          window.LstjoRuntime && window.LstjoRuntime.fetchLiturgie
            ? window.LstjoRuntime.fetchLiturgie(url, init, cfg)
            : fetch(url, Object.assign({ credentials: "omit" }, init));
        return request.then(function (response) {
          return response.text().then(function (body) {
            var data = null;
            try {
              data = JSON.parse(body);
            } catch (eJson) {
              data = null;
            }
            if (!response.ok) {
              throw new Error((data && data.message) || liturgieHttpErrorMessage(response, body));
            }
            return data || {};
          });
        });
      })
      .then(function (data) {
        setStatus(describeMenuActionResult(action, data));
        showResultPopup(action, data);
      })
      .catch(function (err) {
        var msg = (err && err.message) || String(err);
        setStatus(def.label + " : échec — " + msg);
        showResultPopup(action, null, "Échec : " + msg);
      })
      .then(function () {
        setMenuActionsBusy(false, null);
      });
  }

  function initPanelFooter() {
    var buttons = document.querySelectorAll("#panel-footer .panel-footer-btn");
    for (var i = 0; i < buttons.length; i++) {
      (function (btn) {
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          runMenuAction(btn.getAttribute("data-menu-action"), btn);
        });
      })(buttons[i]);
    }
  }

  window.Asc.plugin.init = function () {
    chantStatusEl = document.getElementById("panel-status");
    credentialsBarEl = document.getElementById("panel-credentials");
    chantApiStatusEl = document.getElementById("panel-chant-api-status");
    setChantApiStatus("idle");
    var openSettingsBtn = document.getElementById("panel-open-settings");
    if (openSettingsBtn) {
      openSettingsBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        openSettingsFromPanel();
      });
    }
    lastSettledResolveKey = "";
    lastSettledResolve = null;
    inFlightChantFetch = null;
    applyPanelWindowSize();
    initSplitGutter();
    initPanelHeader();
    initPanelFooter();
    initResultPopup();
    window.addEventListener("pagehide", function () {
      try {
        if (window.Asc && window.Asc.plugin && typeof window.Asc.plugin.sendToPlugin === "function") {
          window.Asc.plugin.sendToPlugin("onlyturgie.panelClosed", { at: Date.now() });
        }
      } catch (eHide) {
        /* ignore */
      }
    });

    if (window.LstjoRuntime && typeof window.LstjoRuntime.syncFromEditorBridge === "function") {
      window.LstjoRuntime.syncFromEditorBridge();
    }
    if (window.Asc && window.Asc.plugin && typeof window.Asc.plugin.attachEvent === "function") {
      window.Asc.plugin.attachEvent("onlyturgie.settingsSaved", onPanelSettingsSaved);
      window.Asc.plugin.attachEvent("onlyturgie.documentSnapshot", onDocumentSnapshot);
    }
    window.addEventListener("message", function (ev) {
      var data = ev.data;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch (e) {
          return;
        }
      }
      // « Connecter Onlyturgie » (page Liturgie ou favori) : lstjo-runtime vient d'enregistrer hôte + jeton.
      if (data && (data.type === "onlyturgie.settingsSaved" || data.type === "onlyturgie:setup" || data.type === "onlyturgie:reset")) {
        setTimeout(onPanelSettingsSaved, 0);
      }
    });
    // Configuration écrite par une autre frame du plugin (partie arrière-plan, autre panneau).
    window.addEventListener("storage", function (ev) {
      if (ev && typeof ev.key === "string" && /^onlyturgie\.(apiToken|apiHost|authMode)$/.test(ev.key)) {
        onPanelSettingsSaved();
      }
    });

    preloadDocsApiScript();

    var cfg = getLstjoConfig();
    loadChantList(cfg)
      .then(function (list) {
        chantList = list;
        resolveUrlsForPanels();
      })
      .catch(function () {
        chantList = [];
        resolveUrlsForPanels();
      });
  };

  window.Asc.plugin.event_onTargetPositionChanged = function () {
    scheduleRefresh();
  };

  window.Asc.plugin.button = function () {
    this.executeCommand("close", "");
  };
})();
