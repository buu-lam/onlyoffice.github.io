(function () {
  "use strict";

  var STORAGE_DATA_KEY = "jsonAutocomplete.itemsBySource";
  var STORAGE_URLS_KEY = "jsonAutocomplete.urls";

  function getLstjoConfig() {
    var p = window.Asc && window.Asc.plugin;
    if (!p) return {};
    if (p.lstjo && typeof p.lstjo === "object") return p.lstjo;
    if (p.variations && p.variations[0] && p.variations[0].lstjo) return p.variations[0].lstjo;
    return {};
  }

  function normalizeData(payload) {
    var source = payload;
    if (!Array.isArray(source)) {
      if (source && Array.isArray(source.items)) source = source.items;
      else if (source && Array.isArray(source.data)) source = source.data;
      else source = [];
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

  function refreshCatalogsInBackground() {
    if (!window.LstjoRuntime) return Promise.resolve();
    window.LstjoRuntime.syncFromEditorBridge();
    var cfg = getLstjoConfig();
    var urls = window.LstjoRuntime.resolveAllSourceUrls(cfg);
    try {
      localStorage.setItem(STORAGE_URLS_KEY, JSON.stringify(urls));
    } catch (e) {
      /* ignore */
    }
    var ids = Object.keys(urls);
    var chain = Promise.resolve();
    var itemsBySource = {};
    ids.forEach(function (sid) {
      chain = chain.then(function () {
        var url = urls[sid];
        if (!url) return;
        return window.LstjoRuntime.fetchLiturgie(url)
          .then(function (response) {
            if (!response.ok) return;
            return response.json().then(function (payload) {
              itemsBySource[sid] = normalizeData(payload);
            });
          })
          .catch(function () {});
      });
    });
    return chain.then(function () {
      try {
        localStorage.setItem(STORAGE_DATA_KEY, JSON.stringify(itemsBySource));
      } catch (e2) {
        /* ignore */
      }
      if (typeof window.lstjoReloadAutocompleteFromStorage === "function") {
        window.lstjoReloadAutocompleteFromStorage();
      }
    });
  }

  function onSettingsSaved() {
    refreshCatalogsInBackground().catch(function () {
      if (typeof window.lstjoReloadAutocompleteFromStorage === "function") {
        window.lstjoReloadAutocompleteFromStorage();
      }
    });
  }

  if (!window.lstjoSettingsSavedListener) {
    window.lstjoSettingsSavedListener = true;
    window.addEventListener("message", function (ev) {
      var data = ev.data;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch (e) {
          return;
        }
      }
      if (data && data.type === "onlyturgie.settingsSaved") {
        onSettingsSaved();
      }
    });
    if (window.Asc && window.Asc.plugin && typeof window.Asc.plugin.attachEvent === "function") {
      window.Asc.plugin.attachEvent("onlyturgie.settingsSaved", onSettingsSaved);
    }
  }

  window.lstjoRefreshAfterSettings = onSettingsSaved;
})();
