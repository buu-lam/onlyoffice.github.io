(function () {
  "use strict";

  var STORAGE_URLS_KEY = "jsonAutocomplete.urls";
  var STORAGE_DATA_KEY = "jsonAutocomplete.itemsBySource";
  var STORAGE_PDF_RATIO_KEY = "onlyturgie.panelPdfRatio";
  var DEFAULT_PDF_RATIO = 0.6;
  var MIN_PDF_RATIO = 0.15;
  var MAX_PDF_RATIO = 0.85;

  var chantList = [];
  var debounceTimer = null;
  var chantStatusEl = null;
  /** Incrémenté à chaque résolution pour ignorer les réponses API obsolètes. */
  var resolveSeq = 0;
  /** Dernier contexte (ligne + chant) déjà résolu — évite les relances si onTargetPositionChanged boucle. */
  var lastSettledResolveKey = "";
  var lastSettledResolve = null;

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

  async function loadChantList(cfg) {
    var panel = (cfg && cfg.panel) || {};
    var sourceId = typeof panel.sourceId === "string" && panel.sourceId ? panel.sourceId : "chant";

    var storedItems = loadItemsFromStorage();
    if (storedItems[sourceId] && storedItems[sourceId].length) {
      return mergeChantList(cfg, sourceId, storedItems[sourceId]);
    }

    var url = "";
    if (window.LstjoRuntime && typeof window.LstjoRuntime.resolveSourceUrl === "function") {
      url = window.LstjoRuntime.resolveSourceUrl(sourceId, cfg);
    } else {
      var urls = loadUrlsFromStorage();
      var sources = (cfg && cfg.sources) || {};
      url = (urls[sourceId] || String(sources[sourceId] || "")).trim();
    }

    if (!url) {
      return mergeChantList(cfg, sourceId, []);
    }

    try {
      var response = window.LstjoRuntime && window.LstjoRuntime.fetchLiturgie
        ? await window.LstjoRuntime.fetchLiturgie(url)
        : await fetch(url, { method: "GET" });
      if (!response.ok) return mergeChantList(cfg, sourceId, []);
      var payload = await response.json();
      return mergeChantList(cfg, sourceId, normalizeData(payload));
    } catch (e) {
      return mergeChantList(cfg, sourceId, []);
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
    if (!apiUrl) return Promise.resolve("");
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
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      })
      .then(function (data) {
        var url = extractUrlFromJson(data, jsonUrlKey);
        return isUsablePanelFileUrl(url) ? url : "";
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

  function bindPane(kind, url, resolveSrc) {
    var emptyEl = document.getElementById("empty-" + kind);
    var iframe = document.getElementById("iframe-" + kind);
    if (!emptyEl || !iframe) return;

    var src = (resolveSrc || function (u) {
      return (u || "").trim();
    })(url);

    if (!src) {
      emptyEl.hidden = false;
      iframe.hidden = true;
      iframe.removeAttribute("src");
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

  function getCursorText(callback) {
    var cfg = getLstjoConfig();
    var panel = (cfg && cfg.panel) || {};
    var lineMode = panel.lineMode || "paragraph";
    var et = window.Asc.plugin.info && window.Asc.plugin.info.editorType;

    if (lineMode === "sentence" || et !== "word") {
      getSentenceText(callback);
      return;
    }

    window.Asc.plugin.callCommand(
      function () {
        var oDocument = Api.GetDocument();
        var oPara = oDocument.GetCurrentParagraph();
        return oPara ? oPara.GetText() : "";
      },
      false,
      false,
      function (text) {
        var raw = String(text || "").trim();
        if (!raw) {
          getSentenceText(callback);
          return;
        }
        if (lineMode === "firstLine") {
          var lines = raw.split(/\r?\n/);
          callback((lines[0] || "").trim());
        } else {
          callback(raw);
        }
      }
    );
  }

  function setStatus(text) {
    if (chantStatusEl) chantStatusEl.textContent = text || "";
  }

  function buildResolveKey(lineText, chant) {
    return normalizeForMatch(lineText) + "\x1e" + String(chant || "");
  }

  function applySettledResolve(snapshot) {
    if (!snapshot) return;
    if (snapshot.statusText) setStatus(snapshot.statusText);
    if (snapshot.pdfEmptyMsg) setEmptyMessage("pdf", snapshot.pdfEmptyMsg);
    if (snapshot.pptEmptyMsg) setEmptyMessage("ppt", snapshot.pptEmptyMsg);
    bindPane("pdf", snapshot.pdfUrl || "");
    bindPane("ppt", snapshot.pptUrl || "", function (u) {
      return resolvePptIframeSrc(u, getPanelCfg().pptUseOfficeViewer !== false);
    });
  }

  function resolveUrlsForPanels() {
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
          : "Ouvrez « Onlyturgie — paramètres » et renseignez l’hôte et le jeton API."
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

    var mySeq = ++resolveSeq;

    getCursorText(function (lineText) {
      var chantMatch = panel.chantMatch === "contains" ? "contains" : "exact";
      var chant = findMatchingChant(lineText, chantList, chantMatch);

      if (!chant) {
        var noChantKey = buildResolveKey(lineText, "");
        if (noChantKey === lastSettledResolveKey && lastSettledResolve && lastSettledResolve.noChant) {
          applySettledResolve(lastSettledResolve);
          return;
        }
        if (mySeq !== resolveSeq) return;
        var noChantStatus = lineText
          ? "Aucun chant reconnu sur cette ligne." + (chantList.length ? "" : " (liste vide — vérifiez la source dans lstjo.panel.)")
          : "Placez le curseur sur une ligne dont le nom d’un chant est dans la liste.";
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
          pdfEmptyMsg: "Aucun chant reconnu sur cette ligne.",
          pptEmptyMsg: "Aucun chant reconnu sur cette ligne.",
        };
        return;
      }

      var resolveKey = buildResolveKey(lineText, chant);
      if (resolveKey === lastSettledResolveKey && lastSettledResolve && !lastSettledResolve.noChant) {
        applySettledResolve(lastSettledResolve);
        return;
      }

      if (mySeq !== resolveSeq) return;

      setStatus("Chant : " + chant);

      function applyPanes(pdfUrl, pptUrl) {
        if (mySeq !== resolveSeq) return;
        bindPane("pdf", pdfUrl || "");
        bindPane("ppt", pptUrl || "", function (u) {
          return resolvePptIframeSrc(u, pptUseOfficeViewer);
        });
      }

      var needPdfApi = !!pdfApiTpl;
      var needPptApi = !!pptApiTpl;
      var needPdfDirect = !!pdfTpl && !pdfApiTpl;
      var needPptDirect = !!pptTpl && !pptApiTpl;

      if (needPdfApi) setEmptyMessage("pdf", "Chargement (API)…");
      else if (needPdfDirect) setEmptyMessage("pdf", "Chargement…");
      if (needPptApi) setEmptyMessage("ppt", "Chargement (API)…");
      else if (needPptDirect) setEmptyMessage("ppt", "Chargement…");

      var pdfPromise;
      if (needPdfApi) {
        pdfPromise = fetchUrlFromApi(pdfApiTpl, chant, jsonUrlKey, cfg).catch(function () {
          return "";
        });
      } else if (needPdfDirect) {
        pdfPromise = Promise.resolve(applyUrlTemplate(pdfTpl, chant));
      } else {
        pdfPromise = Promise.resolve("");
      }

      var pptPromise;
      if (needPptApi) {
        pptPromise = fetchUrlFromApi(pptApiTpl, chant, jsonUrlKey, cfg).catch(function () {
          return "";
        });
      } else if (needPptDirect) {
        pptPromise = Promise.resolve(applyUrlTemplate(pptTpl, chant));
      } else {
        pptPromise = Promise.resolve("");
      }

      Promise.all([pdfPromise, pptPromise]).then(function (pair) {
        if (mySeq !== resolveSeq) return;
        var pdfUrl = pair[0] || "";
        var pptUrl = pair[1] || "";

        var pdfEmptyMsg = "";
        var pptEmptyMsg = "";
        if (!pdfUrl) {
          if (needPdfApi) {
            pdfEmptyMsg =
              "API : pas de clé « " +
              jsonUrlKey +
              " », jeton manquant, ou erreur réseau (vérifiez Onlyturgie — paramètres).";
            setEmptyMessage("pdf", pdfEmptyMsg);
          } else if (needPdfDirect) {
            pdfEmptyMsg = "URL PDF vide (modèle).";
            setEmptyMessage("pdf", pdfEmptyMsg);
          } else {
            pdfEmptyMsg = "PDF non configuré (pdfApiUrlTemplate / pdfUrlTemplate vides).";
            setEmptyMessage("pdf", pdfEmptyMsg);
          }
        }
        if (!pptUrl) {
          if (needPptApi) {
            pptEmptyMsg =
              "API : pas de clé « " +
              jsonUrlKey +
              " », jeton manquant, ou erreur réseau (vérifiez Onlyturgie — paramètres).";
            setEmptyMessage("ppt", pptEmptyMsg);
          } else if (needPptDirect) {
            pptEmptyMsg = "URL présentation vide (modèle).";
            setEmptyMessage("ppt", pptEmptyMsg);
          } else {
            pptEmptyMsg = "Présentation non configurée (pptApiUrlTemplate / pptUrlTemplate vides).";
            setEmptyMessage("ppt", pptEmptyMsg);
          }
        }

        lastSettledResolveKey = resolveKey;
        lastSettledResolve = {
          noChant: false,
          statusText: "Chant : " + chant,
          pdfUrl: pdfUrl,
          pptUrl: pptUrl,
          pdfEmptyMsg: pdfEmptyMsg,
          pptEmptyMsg: pptEmptyMsg,
        };

        applyPanes(pdfUrl, pptUrl);
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

    function applyRatio(r) {
      if (typeof r !== "number" || isNaN(r)) r = DEFAULT_PDF_RATIO;
      r = Math.max(MIN_PDF_RATIO, Math.min(MAX_PDF_RATIO, r));
      var a = r * 100;
      var b = (1 - r) * 100;
      wrap.style.gridTemplateRows = "minmax(0," + a + "fr) " + gutterTrack() + " minmax(0," + b + "fr)";
      try {
        localStorage.setItem(STORAGE_PDF_RATIO_KEY, String(r));
      } catch (e) {
        /* ignore */
      }
    }

    try {
      var raw = localStorage.getItem(STORAGE_PDF_RATIO_KEY);
      if (raw !== null && raw !== "") {
        var saved = parseFloat(raw);
        if (!isNaN(saved)) applyRatio(saved);
      }
    } catch (e) {
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
      applyRatio(ratioFromClientY(y));
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

  window.Asc.plugin.init = function () {
    chantStatusEl = document.getElementById("panel-status");
    lastSettledResolveKey = "";
    lastSettledResolve = null;
    applyPanelWindowSize();
    initSplitGutter();

    if (window.LstjoRuntime && typeof window.LstjoRuntime.syncFromEditorBridge === "function") {
      window.LstjoRuntime.syncFromEditorBridge();
    }

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
