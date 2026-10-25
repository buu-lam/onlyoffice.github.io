(function () {
  "use strict";

  var STORAGE_URLS_KEY = "jsonAutocomplete.urls";
  var STORAGE_DATA_KEY = "jsonAutocomplete.itemsBySource";
  var STORAGE_TAG_MAP_KEY = "jsonAutocomplete.tagMap";

  var urlsBySource = {};
  var itemsBySource = {};
  var inputEventSeq = 0;

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

  function parseSourceFromTag(tag) {
    if (!tag || typeof tag !== "string") return null;
    var raw = tag.trim();
    var lower = raw.toLowerCase();
    if (!lower) return null;

    var map = getMergedTagMap();
    var mapped = map[raw] || map[lower];
    if (mapped) {
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

  async function bootstrapFetchRemoteSources() {
    var ids = Object.keys(urlsBySource);
    for (var i = 0; i < ids.length; i++) {
      var sid = ids[i];
      var url = urlsBySource[sid];
      if (!url) continue;
      try {
        var response = await fetch(url, { method: "GET" });
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

      window.Asc.plugin.fullText = "";
      window.Asc.plugin.lastReplaceTarget = "";
      rebuildStateFromConfigAndStorage();

      bootstrapFetchRemoteSources().catch(function () {});

      window.Asc.plugin.createInputHelper();
      window.Asc.plugin.getInputHelper().createWindow();
    }
  };

  window.Asc.plugin.button = function () {
    this.executeCommand("close", "");
  };

  window.Asc.plugin.inputHelper_onSelectItem = function (item) {
    if (!item || !item.text) return;
    if (getCompletionScope() === "word") {
      var toReplace = window.Asc.plugin.lastReplaceTarget;
      if (toReplace === undefined || toReplace === null) toReplace = getReplaceSegment();
      if (toReplace === "") return;
      window.Asc.plugin.executeMethod("InputText", [item.text, toReplace]);
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

    syncFullTextFromData(data);

    var seq = ++inputEventSeq;
    var minChars = getMinChars();

    function showSuggestionsForQuery(query) {
      if (seq !== inputEventSeq) return;
      query = (query || "").trim();
      if (query.length < minChars) {
        window.Asc.plugin.getInputHelper().unShow();
        return;
      }

      window.Asc.plugin.lastReplaceTarget = query;

      window.Asc.plugin.executeMethod("GetCurrentContentControlPr", [], function (obj) {
        if (seq !== inputEventSeq) return;

        var sourceId = resolveActiveSourceId(obj);
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
        window.Asc.plugin.lastReplaceTarget = query;
        var sizes = getInputHelperSize();
        window.Asc.plugin.getInputHelper().show(sizes.w, sizes.h, false);
      });
    }

    if (getCompletionScope() === "word") {
      showSuggestionsForQuery(getReplaceSegment());
      return;
    }

    window.Asc.plugin.executeMethod("GetCurrentSentence", ["entirely"], function (sentence) {
      if (seq !== inputEventSeq) return;
      var q = (sentence || "").trim();
      if (!q) {
        q = getReplaceSegment().trim();
      }
      showSuggestionsForQuery(q);
    });
  };
})();
