(function () {
  "use strict";

  var STORAGE_URLS_KEY = "jsonAutocomplete.urls";
  var STORAGE_DATA_KEY = "jsonAutocomplete.itemsBySource";
  var STORAGE_TAG_MAP_KEY = "jsonAutocomplete.tagMap";

  var urlsBySource = {};
  var itemsBySource = {};
  var inputEventSeq = 0;
  /** InternalId du contrôle de contenu sous le curseur lors de la dernière saisie ("" = hors contrôle). */
  var activeContentControlId = "";

  function isAutocompleteEnabled() {
    if (window.LstjoRuntime && typeof window.LstjoRuntime.readAutocompleteEnabledPreference === "function") {
      return window.LstjoRuntime.readAutocompleteEnabledPreference();
    }
    return true;
  }

  function hideInputHelperIfDisabled() {
    if (!isAutocompleteEnabled() && window.Asc && window.Asc.plugin && window.Asc.plugin.getInputHelper) {
      window.Asc.plugin.getInputHelper().unShow();
    }
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

  function getMinChars() {
    var n = getLstjoConfig().minChars;
    return typeof n === "number" && n >= 0 ? n : 1;
  }

  function getMaxResults() {
    var n = getLstjoConfig().maxResults;
    return typeof n === "number" && n > 0 ? n : 20;
  }

  /** "full" = phrase courante dans le document (GetCurrentSentence / ReplaceCurrentSentence). "word" = fragment Input helper + InputText (mot). */
  function getCompletionScope() {
    var s = getLstjoConfig().completionScope;
    return s === "word" ? "word" : "full";
  }

  function syncFullTextFromData(data) {
    if (data.add) {
      window.Asc.plugin.fullText += data.text;
    } else {
      window.Asc.plugin.fullText = data.text;
    }
  }

  /** Texte que InputText doit remplacer (2e argument) : ligne courante ou dernier mot selon le mode. */
  function getReplaceSegment() {
    var t = window.Asc.plugin.fullText || "";
    if (getCompletionScope() === "word") {
      var lastIndexSpace = t.lastIndexOf(" ");
      if (lastIndexSpace >= 0) {
        if (lastIndexSpace === t.length - 1) return "";
        return t.substr(lastIndexSpace + 1);
      }
      return t;
    }
    var lines = t.split(/\r?\n/);
    return lines[lines.length - 1] || "";
  }

  function getSourceIds() {
    var keys = Object.keys(urlsBySource);
    if (keys.length) return keys;
    if (window.LstjoRuntime && typeof window.LstjoRuntime.getSourceIds === "function") {
      return window.LstjoRuntime.getSourceIds(getLstjoConfig());
    }
    return Object.keys(getLstjoConfig().sources || {});
  }

  function isValidSourceId(id) {
    if (!id || typeof id !== "string") return false;
    return getSourceIds().indexOf(id) !== -1;
  }

  function findSourceIdByName(name) {
    if (!name || typeof name !== "string") return null;
    var lower = name.trim().toLowerCase();
    if (!lower) return null;
    var ids = getSourceIds();
    for (var i = 0; i < ids.length; i++) {
      if (ids[i].toLowerCase() === lower) return ids[i];
    }
    return null;
  }

  function emptyItemsMapForUrls(urlMap) {
    var out = {};
    Object.keys(urlMap).forEach(function (id) {
      out[id] = [];
    });
    return out;
  }

  function mergeItemsWithNewUrls(oldItems, newUrls) {
    var out = emptyItemsMapForUrls(newUrls);
    Object.keys(newUrls).forEach(function (id) {
      if (oldItems[id] && Array.isArray(oldItems[id])) {
        out[id] = oldItems[id].map(function (x) {
          return String(x);
        });
      }
    });
    return out;
  }

  function loadSavedUrls() {
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
    } catch (error) {
      return {};
    }
  }

  function loadSavedDataBySource() {
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
    } catch (error) {
      return {};
    }
  }

  function saveDataBySource() {
    localStorage.setItem(STORAGE_DATA_KEY, JSON.stringify(itemsBySource));
  }

  function rebuildUrlsFromConfigAndStorage() {
    if (window.LstjoRuntime && typeof window.LstjoRuntime.resolveAllSourceUrls === "function") {
      urlsBySource = window.LstjoRuntime.resolveAllSourceUrls(getLstjoConfig());
      return;
    }
    var cfg = getLstjoConfig();
    var sources = (cfg && cfg.sources) || {};
    var fromStorage = loadSavedUrls();
    urlsBySource = {};
    Object.keys(sources).forEach(function (k) {
      urlsBySource[k] = String(sources[k] || "").trim();
    });
    Object.keys(fromStorage).forEach(function (k) {
      if (fromStorage[k]) urlsBySource[k] = fromStorage[k];
    });
  }

  function applyInlineItemsFromConfig() {
    var cfg = getLstjoConfig();
    var inline = cfg.inlineItems || {};
    Object.keys(inline).forEach(function (sid) {
      if (!Array.isArray(inline[sid])) return;
      var arr = inline[sid]
        .map(function (item) {
          return String(item).trim();
        })
        .filter(Boolean);
      if (!arr.length) return;
      if (!itemsBySource[sid] || itemsBySource[sid].length === 0) {
        itemsBySource[sid] = arr;
      }
    });
  }

  function rebuildStateFromConfigAndStorage() {
    rebuildUrlsFromConfigAndStorage();
    var saved = loadSavedDataBySource();
    itemsBySource = mergeItemsWithNewUrls(saved, urlsBySource);
    applyInlineItemsFromConfig();
    saveDataBySource();
  }

  function normalizeData(payload) {
    var source = payload;

    if (!Array.isArray(source)) {
      if (source && Array.isArray(source.suggestions)) {
        source = source.suggestions;
      } else if (source && Array.isArray(source.items)) {
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

  function getMergedTagMap() {
    var fromFile = {};
    var cfg = getLstjoConfig();
    if (cfg.tagMap && typeof cfg.tagMap === "object" && !Array.isArray(cfg.tagMap)) {
      fromFile = cfg.tagMap;
    }
    var fromStorage = {};
    try {
      var raw = localStorage.getItem(STORAGE_TAG_MAP_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) fromStorage = parsed;
      }
    } catch (e) {
      fromStorage = {};
    }
    var out = {};
    Object.keys(fromFile).forEach(function (k) {
      out[k] = fromFile[k];
    });
    Object.keys(fromStorage).forEach(function (k) {
      out[k] = fromStorage[k];
    });
    return out;
  }

  /** Clé de comparaison : minuscules, sans accents ni « : » / espaces superflus. */
  function normalizeTagKey(s) {
    var t = String(s || "").toLowerCase();
    if (t.normalize) t = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return t.replace(/[\s:]+$/g, "").replace(/\s+/g, " ").trim();
  }

  /** tagMap avec clés normalisées (« Animation », « animation : » → même entrée). */
  function lookupTagMap(raw) {
    var map = getMergedTagMap();
    if (map[raw]) return map[raw];
    var key = normalizeTagKey(raw);
    var keys = Object.keys(map);
    for (var i = 0; i < keys.length; i++) {
      if (normalizeTagKey(keys[i]) === key) return map[keys[i]];
    }
    return null;
  }

  function parseSourceFromTag(tag, depth) {
    if (!tag || typeof tag !== "string") return null;
    var raw = tag.trim();
    var lower = raw.toLowerCase();
    if (!lower) return null;

    // Tag = nom d’un groupe Nextcloud connu → membres du groupe (prioritaire sur le catalogue homonyme).
    var rt = window.LstjoRuntime;
    if (rt && rt.GROUP_TAGS && rt.GROUP_TAGS.indexOf(lower) !== -1) {
      var gid = rt.GROUP_SOURCE_PREFIX + lower;
      if (urlsBySource[gid]) return gid;
    }

    var mapped = lookupTagMap(raw);
    if (mapped) {
      // Cible = groupe ou autre tag (« Animation » → « animateurs ») : résolution complète, un niveau.
      if (!depth) {
        var viaTag = parseSourceFromTag(String(mapped), 1);
        if (viaTag) return viaTag;
      }
      var id1 = findSourceIdByName(String(mapped));
      if (id1) return id1;
      if (isValidSourceId(String(mapped))) return String(mapped);
    }

    if (lower.indexOf("source:") === 0) {
      var rest = lower.slice("source:".length).trim();
      var id2 = findSourceIdByName(rest);
      if (id2) return id2;
    }

    var id3 = findSourceIdByName(lower);
    if (id3) return id3;
    return null;
  }

  function getDefaultSourceId() {
    var cfg = getLstjoConfig();
    var d = (cfg && cfg.defaultSource) || "chant";
    var id = findSourceIdByName(String(d));
    if (id) return id;
    var ids = getSourceIds();
    return ids.length ? ids[0] : "chant";
  }

  function resolveActiveSourceId(contentControlObj) {
    var rawTag = "";
    if (contentControlObj && contentControlObj.Tag) {
      rawTag = String(contentControlObj.Tag).trim();
    }
    var fromTag = parseSourceFromTag(rawTag);
    if (fromTag) return fromTag;
    return getDefaultSourceId();
  }

  function filterItemsForQuery(sourceId, query) {
    var all = itemsBySource[sourceId] || [];
    var q = (query || "").toLowerCase().trim();
    var max = getMaxResults();
    if (!q) return all.slice(0, max);
    return all
      .filter(function (item) {
        return item.toLowerCase().indexOf(q) !== -1;
      })
      .slice(0, max);
  }

  function getInputHelperSize() {
    var cfg = getLstjoConfig();
    var baseW =
      typeof cfg.helperWidth === "number" && cfg.helperWidth > 0
        ? cfg.helperWidth
        : typeof cfg.helperWidthMm === "number" && cfg.helperWidthMm > 0
          ? cfg.helperWidthMm
          : 320;
    var maxW =
      typeof cfg.helperMaxWidth === "number" && cfg.helperMaxWidth > 0
        ? cfg.helperMaxWidth
        : typeof cfg.helperMaxWidthMm === "number" && cfg.helperMaxWidthMm > 0
          ? cfg.helperMaxWidthMm
          : 920;

    var size = window.Asc.plugin.getInputHelper().getScrollSizes();
    var width = baseW;
    var height = size.h;
    var ih = window.Asc.plugin.getInputHelper();
    var heightMin = ih.getItemsHeight(Math.min(5, ih.getItems().length));

    if (width > maxW) width = maxW;
    if (height > heightMin) height = heightMin;

    width += 36;

    return { w: width, h: height };
  }

  function openOnlyturgieSettingsWindow() {
    if (window.LstjoRuntime && typeof window.LstjoRuntime.openOnlyturgieSettingsWindow === "function") {
      window.LstjoRuntime.openOnlyturgieSettingsWindow({
        onClose: function () {
          refreshAfterSettingsSave().catch(function () {
            window.lstjoReloadAutocompleteFromStorage();
          });
        },
      });
    }
  }

  function registerSettingsContextMenu() {
    if (window.lstjoSettingsMenuRegistered || !window.Asc || !window.Asc.ButtonContextMenu) {
      return;
    }
    window.lstjoSettingsMenuRegistered = true;
    var btn = new window.Asc.ButtonContextMenu();
    btn.text = "Paramètres Onlyturgie";
    btn.addCheckers("All");
    btn.attachOnClick(function () {
      openOnlyturgieSettingsWindow();
    });
    window.Asc.Buttons.registerContextMenu();
  }

  function refreshAfterSettingsSave() {
    if (window.LstjoRuntime && typeof window.LstjoRuntime.syncFromEditorBridge === "function") {
      window.LstjoRuntime.syncFromEditorBridge();
    }
    rebuildStateFromConfigAndStorage();
    return bootstrapFetchRemoteSources();
  }

  window.lstjoReloadAutocompleteFromStorage = function () {
    rebuildStateFromConfigAndStorage();
  };

  function registerSettingsSavedListener() {
    if (window.lstjoPluginSettingsSavedRegistered) {
      return;
    }
    window.lstjoPluginSettingsSavedRegistered = true;
    function onSettingsSavedInBackground() {
      refreshAfterSettingsSave().catch(function () {
        window.lstjoReloadAutocompleteFromStorage();
      });
    }
    if (window.Asc && window.Asc.plugin && typeof window.Asc.plugin.attachEvent === "function") {
      window.Asc.plugin.attachEvent("onlyturgie.settingsSaved", onSettingsSavedInBackground);
      window.Asc.plugin.attachEvent("onlyturgie.openSettings", function () {
        openOnlyturgieSettingsWindow();
      });
      window.Asc.plugin.attachEvent("onlyturgie.autocompleteToggled", function (data) {
        if (data && typeof data.enabled === "boolean" && window.LstjoRuntime &&
            typeof window.LstjoRuntime.writeAutocompleteEnabledPreference === "function") {
          window.LstjoRuntime.writeAutocompleteEnabledPreference(data.enabled);
        }
        hideInputHelperIfDisabled();
      });
      window.Asc.plugin.attachEvent("onlyturgie.catalogUpdated", function () {
        if (typeof window.lstjoReloadAutocompleteFromStorage === "function") {
          window.lstjoReloadAutocompleteFromStorage();
        }
      });
      // Pied du panneau : le panneau (fenêtre enfant) demande le texte et l’identité du document.
      window.Asc.plugin.attachEvent("onlyturgie.collectDocument", function (data) {
        var reqId = data && data.reqId;
        if (!window.LstjoRuntime || typeof window.LstjoRuntime.collectDocumentSnapshot !== "function") return;
        window.LstjoRuntime.collectDocumentSnapshot(function (snapshot) {
          snapshot.reqId = reqId;
          window.LstjoRuntime.forwardEventToPanelWindow("onlyturgie.documentSnapshot", snapshot);
        });
      });
      window.Asc.plugin.attachEvent("onlyturgie.panelClosed", function () {
        if (
          window.LstjoRuntime &&
          typeof window.LstjoRuntime.scheduleRegisterOnlyturgiePanelRightNav === "function"
        ) {
          window.LstjoRuntime.scheduleRegisterOnlyturgiePanelRightNav();
        }
      });
    }
  }

  function registerPanelAutoOpenOnActivation() {
    if (window.lstjoPanelActivationOpenRegistered) {
      return;
    }
    window.lstjoPanelActivationOpenRegistered = true;
    if (
      window.LstjoRuntime &&
      typeof window.LstjoRuntime.scheduleEnsureOnlyturgiePanelOnPluginActivation === "function"
    ) {
      window.LstjoRuntime.scheduleEnsureOnlyturgiePanelOnPluginActivation();
    }
  }

  function registerPanelAutoOpenOnDocument() {
    if (window.lstjoPanelAutoOpenRegistered) {
      return;
    }
    window.lstjoPanelAutoOpenRegistered = true;
    function onDocumentReady() {
      if (window.LstjoRuntime && typeof window.LstjoRuntime.resetPanelAutoOpenForDocument === "function") {
        window.LstjoRuntime.resetPanelAutoOpenForDocument();
      }
      if (
        window.LstjoRuntime &&
        typeof window.LstjoRuntime.scheduleEnsureOnlyturgiePanelOnDocument === "function"
      ) {
        window.LstjoRuntime.scheduleEnsureOnlyturgiePanelOnDocument();
      } else if (
        window.LstjoRuntime &&
        typeof window.LstjoRuntime.scheduleEnsureOnlyturgiePanelVisible === "function"
      ) {
        window.LstjoRuntime.scheduleEnsureOnlyturgiePanelVisible();
      }
    }
    if (window.Asc && window.Asc.plugin && typeof window.Asc.plugin.attachEditorEvent === "function") {
      window.Asc.plugin.attachEditorEvent("onDocumentContentReady", onDocumentReady);
    }
  }

  async function bootstrapFetchRemoteSources() {
    var ids = Object.keys(urlsBySource);
    for (var i = 0; i < ids.length; i++) {
      var sid = ids[i];
      var url = urlsBySource[sid];
      if (!url) continue;
      // Diapos : dossier « Diapos » à côté du docx ouvert (+ Visionneuse/Commun) — l’API a besoin du document.
      if (sid.toLowerCase() === "diapo" && window.LstjoRuntime && window.LstjoRuntime.withDocumentContext) {
        url = window.LstjoRuntime.withDocumentContext(url);
      }
      try {
        var response = window.LstjoRuntime && window.LstjoRuntime.fetchLiturgie
          ? await window.LstjoRuntime.fetchLiturgie(url)
          : await fetch(url, { method: "GET" });
        if (!response.ok) continue;
        var payload = await response.json();
        itemsBySource[sid] = normalizeData(payload);
      } catch (e) {
        /* ignore */
      }
    }
    saveDataBySource();
  }

  window.Asc.plugin.init = function () {
    if (!window.lstjoPluginInit) {
      window.lstjoPluginInit = true;

      if (window.LstjoRuntime && typeof window.LstjoRuntime.syncFromEditorBridge === "function") {
        window.LstjoRuntime.syncFromEditorBridge();
      }

      window.Asc.plugin.fullText = "";
      window.Asc.plugin.lastReplaceTarget = "";
      rebuildStateFromConfigAndStorage();

      bootstrapFetchRemoteSources().catch(function () {});

      window.Asc.plugin.createInputHelper();
      window.Asc.plugin.getInputHelper().createWindow();
      registerSettingsContextMenu();
      registerSettingsSavedListener();
      registerPanelAutoOpenOnDocument();
      registerPanelAutoOpenOnActivation();
      hideInputHelperIfDisabled();
      if (
        window.LstjoRuntime &&
        typeof window.LstjoRuntime.scheduleEnsureOnlyturgiePanelOnPluginActivation === "function"
      ) {
        window.LstjoRuntime.scheduleEnsureOnlyturgiePanelOnPluginActivation();
      } else if (
        window.LstjoRuntime &&
        typeof window.LstjoRuntime.scheduleEnsureOnlyturgiePanelVisible === "function"
      ) {
        window.LstjoRuntime.scheduleEnsureOnlyturgiePanelVisible();
      }
    }
  };

  window.Asc.plugin.event_onDocumentContentReady = function () {
    if (window.LstjoRuntime && typeof window.LstjoRuntime.resetPanelAutoOpenForDocument === "function") {
      window.LstjoRuntime.resetPanelAutoOpenForDocument();
    }
    if (
      window.LstjoRuntime &&
      typeof window.LstjoRuntime.scheduleEnsureOnlyturgiePanelOnDocument === "function"
    ) {
      window.LstjoRuntime.scheduleEnsureOnlyturgiePanelOnDocument();
    } else if (
      window.LstjoRuntime &&
      typeof window.LstjoRuntime.scheduleEnsureOnlyturgiePanelVisible === "function"
    ) {
      window.LstjoRuntime.scheduleEnsureOnlyturgiePanelVisible();
    }
  };

  /** Le panneau est une fenêtre enfant : il ne reçoit pas les événements éditeur, on les lui relaie. */
  window.Asc.plugin.event_onTargetPositionChanged = function () {
    if (window.LstjoRuntime && typeof window.LstjoRuntime.forwardEventToPanelWindow === "function") {
      window.LstjoRuntime.forwardEventToPanelWindow("onTargetPositionChanged", {});
    }
  };

  window.Asc.plugin.button = function (id, windowId) {
    if (windowId) {
      window.Asc.plugin.executeMethod("CloseWindow", [windowId]);
      return;
    }
    this.executeCommand("close", "");
  };

  function replaceContentControlText(internalId, text) {
    window.Asc.scope.lstjoCcId = internalId;
    window.Asc.scope.lstjoCcText = text;
    window.Asc.scope.lstjoCcQuery = window.Asc.plugin.lastReplaceTarget || "";
    window.Asc.plugin.callCommand(
      function () {
        var id = Asc.scope.lstjoCcId;
        var txt = Asc.scope.lstjoCcText;
        var query = String(Asc.scope.lstjoCcQuery || "").trim();
        /** Lignes du contrôle (un paragraphe ou un saut de ligne = une ligne), sans le texte d'invite. */
        function controlLines(cc, isInline) {
          var out = [];
          if (isInline) {
            var range = typeof cc.GetRange === "function" ? cc.GetRange() : null;
            var t = range ? range.GetText({ NewLineSeparator: "\n", ParaSeparator: "\n", TabSymbol: " " }) : "";
            out = String(t || "").split(/\r\n|\r|\n/);
          } else {
            var c = cc.GetContent();
            for (var k = 0; k < c.GetElementsCount(); k++) {
              var el = c.GetElement(k);
              if (el && typeof el.GetText === "function") {
                out = out.concat(String(el.GetText({ NewLineSeparator: "\n" }) || "").replace(/[\r\n]+$/, "").split(/\r\n|\r|\n/));
              }
            }
          }
          var ph = typeof cc.GetPlaceholderText === "function" ? String(cc.GetPlaceholderText() || "").trim() : "";
          return out.filter(function (l) {
            return !(ph && String(l).trim() === ph);
          });
        }
        /** Index de la ligne tapée (dernière égale à la saisie, sinon dernière qui la contient), -1 si aucune. */
        function findTypedLine(lines, q) {
          if (!q) return -1;
          var lq = q.toLowerCase();
          for (var a = lines.length - 1; a >= 0; a--) {
            if (String(lines[a]).trim().toLowerCase() === lq) return a;
          }
          for (var c2 = lines.length - 1; c2 >= 0; c2--) {
            if (String(lines[c2]).toLowerCase().indexOf(lq) !== -1) return c2;
          }
          return -1;
        }
        // Police et taille du premier run (sinon le texte inséré prend la police par défaut du document).
        function firstRunFont(container, depth) {
          if (!container || typeof container.GetElementsCount !== "function" || depth > 2) return null;
          var n = container.GetElementsCount();
          for (var k = 0; k < n; k++) {
            var el = container.GetElement(k);
            if (!el) continue;
            if (typeof el.GetTextPr === "function" && typeof el.AddText === "function" && typeof el.GetElementsCount !== "function") {
              var pr = el.GetTextPr();
              if (!pr) continue;
              var size = typeof pr.GetFontSize === "function" ? pr.GetFontSize() : null;
              var family = typeof pr.GetFontFamily === "function" ? pr.GetFontFamily() : null;
              if (size || family) return { size: size, family: family };
            } else {
              var inner = firstRunFont(el, depth + 1);
              if (inner) return inner;
            }
          }
          return null;
        }
        function styledRun(text, font) {
          var run = Api.CreateRun();
          var parts = String(text).split("\n");
          for (var b = 0; b < parts.length; b++) {
            if (b > 0) run.AddLineBreak();
            run.AddText(parts[b]);
          }
          if (font) {
            if (font.size) run.SetFontSize(font.size); // GetFontSize / SetFontSize : demi-points
            if (font.family) run.SetFontFamily(font.family);
          }
          return run;
        }
        var all = Api.GetDocument().GetAllContentControls() || [];
        for (var i = 0; i < all.length; i++) {
          var cc = all[i];
          if (String(cc.GetInternalId()) !== id) continue;
          var font = null;
          try {
            font = firstRunFont(cc.GetClassType() === "inlineLvlSdt" ? cc : cc.GetContent(), 0);
          } catch (e) {
            font = null;
          }
          var isInline = cc.GetClassType() === "inlineLvlSdt";
          // Plusieurs noms (un par ligne) : on ne remplace que la ligne en cours de saisie.
          var lines = [];
          try {
            lines = controlLines(cc, isInline);
          } catch (e) {
            lines = [];
          }
          var idx = findTypedLine(lines, query);
          if (idx === -1) lines = [txt];
          else lines[idx] = txt;
          lines = lines.filter(function (l) {
            return String(l).trim() !== "";
          });
          if (isInline) {
            cc.RemoveAllElements();
            cc.AddElement(styledRun(lines.join("\n"), font), 0);
          } else {
            var content = cc.GetContent();
            content.RemoveAllElements();
            for (var li = 0; li < lines.length; li++) {
              var p = Api.CreateParagraph();
              p.AddElement(styledRun(lines[li], font));
              content.Push(p);
            }
          }
          return true;
        }
        return false;
      },
      false,
      true,
      function (found) {
        if (!found) window.Asc.plugin.executeMethod("ReplaceCurrentSentence", [text, "entirely"]);
      }
    );
  }

  window.Asc.plugin.inputHelper_onSelectItem = function (item) {
    if (!item || !item.text) return;
    var et = window.Asc.plugin.info && window.Asc.plugin.info.editorType;
    if (getCompletionScope() === "word" || et === "cell") {
      // Tableur : pas de ReplaceCurrentSentence ni de contrôle de contenu → InputText remplace la saisie en cours.
      var toReplace = window.Asc.plugin.lastReplaceTarget;
      if (toReplace === undefined || toReplace === null) toReplace = getReplaceSegment();
      if (toReplace === "") return;
      window.Asc.plugin.executeMethod("InputText", [item.text, toReplace]);
    } else if (activeContentControlId) {
      // Dans un contrôle de contenu : remplacer seulement son contenu (ReplaceCurrentSentence
      // déborde sur la phrase entière autour d’un contrôle inline, ex. « Animateur : [nom] »).
      replaceContentControlText(activeContentControlId, item.text);
    } else {
      window.Asc.plugin.executeMethod("ReplaceCurrentSentence", [item.text, "entirely"]);
    }
    window.Asc.plugin.getInputHelper().unShow();
  };

  window.Asc.plugin.event_onInputHelperClear = function () {
    window.Asc.plugin.fullText = "";
    window.Asc.plugin.lastReplaceTarget = "";
    window.Asc.plugin.getInputHelper().unShow();
  };

  window.Asc.plugin.event_onInputHelperInput = function (data) {
    if (!data) return;
    if (!isAutocompleteEnabled()) {
      hideInputHelperIfDisabled();
      return;
    }

    syncFullTextFromData(data);

    var seq = ++inputEventSeq;
    var minChars = getMinChars();
    var isSheet = !!(window.Asc.plugin.info && window.Asc.plugin.info.editorType === "cell");

    function showSuggestionsForQuery(query) {
      if (seq !== inputEventSeq) return;
      var rawQuery = String(query || "");
      query = rawQuery.trim();
      // Tableur : un ou plusieurs espaces seuls dans la cellule → liste complète (le clic remplace les espaces).
      var spaceTrigger = isSheet && !query && /^ +$/.test(rawQuery);
      if (!spaceTrigger && query.length < minChars) {
        window.Asc.plugin.getInputHelper().unShow();
        return;
      }
      var replaceTarget = spaceTrigger ? rawQuery : query;

      window.Asc.plugin.lastReplaceTarget = replaceTarget;

      function showForSource(sourceId) {
        if (seq !== inputEventSeq) return;
        var variants = filterItemsForQuery(sourceId, query);

        if (!variants.length) {
          window.Asc.plugin.getInputHelper().unShow();
          return;
        }

        var items = [];
        for (var i = 0; i < variants.length; i++) {
          items.push({ text: variants[i], id: String(i) });
        }

        window.Asc.plugin.getInputHelper().setItems(items);
        window.Asc.plugin.lastReplaceTarget = replaceTarget;
        var sizes = getInputHelperSize();
        window.Asc.plugin.getInputHelper().show(sizes.w, sizes.h, false);
      }

      window.Asc.plugin.executeMethod("GetCurrentContentControlPr", [], function (obj) {
        if (seq !== inputEventSeq) return;
        activeContentControlId = obj && obj.InternalId ? String(obj.InternalId) : "";
        var fromTag = obj && obj.Tag ? parseSourceFromTag(String(obj.Tag).trim()) : null;
        if (fromTag || obj) {
          showForSource(fromTag || getDefaultSourceId());
          return;
        }
        // Hors contrôle de contenu : « Diapo » dans la cellule de gauche → catalogue des diapos.
        var rt = window.LstjoRuntime;
        if (!rt || typeof rt.readCursorCellContext !== "function") {
          showForSource(getDefaultSourceId());
          return;
        }
        var et = window.Asc.plugin.info && window.Asc.plugin.info.editorType;
        if (et === "cell") {
          // Tableur : en-tête de colonne, puis cellule de gauche (via tagMap / noms de groupe).
          rt.readCursorCellContext(function (ctx) {
            if (seq !== inputEventSeq) return;
            var id =
              parseSourceFromTag(ctx.header || "") ||
              parseSourceFromTag(ctx.left || "") ||
              (rt.isDiapoCellLabel(ctx.left) ? findSourceIdByName("diapo") : null);
            showForSource(id || getDefaultSourceId());
          });
          return;
        }
        // Hors contrôle (ex. nouvelle ligne après Entrée sous « Anne Leroy ») : tag du contrôle de la cellule,
        // puis en-tête de colonne (« Animation »), puis « Diapo » à gauche.
        rt.readCursorCellContext(function (ctx) {
          if (seq !== inputEventSeq) return;
          var id =
            parseSourceFromTag(ctx.cellTag || "") ||
            parseSourceFromTag(ctx.header || "") ||
            (rt.isDiapoCellLabel(ctx.left) ? findSourceIdByName("diapo") : null);
          showForSource(id || getDefaultSourceId());
        });
      });
    }

    if (getCompletionScope() === "word" || isSheet) {
      // Tableur : le texte saisi dans la cellule suffit (pas de phrase courante), espaces conservés.
      showSuggestionsForQuery(getReplaceSegment());
      return;
    }

    window.Asc.plugin.executeMethod("GetCurrentSentence", ["entirely"], function (sentence) {
      if (seq !== inputEventSeq) return;
      var segment = getReplaceSegment().trim();
      var sentenceTrim = (sentence || "").trim();
      var q = segment || sentenceTrim;
      showSuggestionsForQuery(q);
    });
  };
})();
