(function () {
  "use strict";

  function updateTokenFieldVisibility() {
    var modeEl = document.getElementById("auth-mode");
    var tokenField = document.getElementById("token-field");
    if (!modeEl || !tokenField) return;
    var mode = modeEl.value;
    tokenField.style.display = mode === "nextcloud" ? "none" : "";
  }

  function displayPluginVersion(version) {
    var v = version ? String(version).trim() : "";
    if (!v) v = "?";
    var el = document.getElementById("plugin-version");
    if (el) {
      el.textContent = "Onlyturgie — version " + v;
    }
    document.title = "Onlyturgie v" + v + " — paramètres";
  }

  function loadPluginVersion(callback) {
    var p = window.Asc && window.Asc.plugin;
    if (p && p.version) {
      callback(p.version);
      return;
    }
    fetch("config.json", { method: "GET", cache: "no-store" })
      .then(function (response) {
        if (!response.ok) throw new Error("config");
        return response.json();
      })
      .then(function (json) {
        callback(json && json.version ? json.version : "?");
      })
      .catch(function () {
        callback("?");
      });
  }

  function updateTemplateLabel() {
    var tplEl = document.getElementById("template-label");
    if (!tplEl || !window.LstjoRuntime) return;
    var path = window.LstjoRuntime.getApiPath();
    var tpl = window.LstjoRuntime.getSourceUrlTemplate();
    var mode = window.LstjoRuntime.getEffectiveAuthMode
      ? window.LstjoRuntime.getEffectiveAuthMode()
      : "token";
    tplEl.textContent =
      "Mode effectif : " +
      mode +
      " — modèle source : " +
      tpl +
      " — apiBase = {hôte}" +
      path;
  }

  window.Asc.plugin.init = function () {
    loadPluginVersion(displayPluginVersion);
    var hostEl = document.getElementById("api-host");
    var tokenEl = document.getElementById("api-token");
    var modeEl = document.getElementById("auth-mode");
    if (hostEl) {
      hostEl.value = window.LstjoRuntime.getApiHost();
    }
    if (tokenEl) {
      tokenEl.value = window.LstjoRuntime.getApiToken();
    }
    if (modeEl) {
      var stored = window.LstjoRuntime.getAuthMode();
      modeEl.value = stored || "auto";
      modeEl.addEventListener("change", function () {
        updateTokenFieldVisibility();
        updateTemplateLabel();
      });
    }
    updateTokenFieldVisibility();
    updateTemplateLabel();

    var testBtn = document.getElementById("test-chant-btn");
    if (testBtn) {
      testBtn.addEventListener("click", function () {
        var hostEl = document.getElementById("api-host");
        var tokenEl = document.getElementById("api-token");
        var modeEl = document.getElementById("auth-mode");
        if (hostEl) window.LstjoRuntime.setApiHost(hostEl.value);
        if (tokenEl) window.LstjoRuntime.setApiToken(tokenEl.value);
        if (modeEl) window.LstjoRuntime.setAuthMode(modeEl.value);
        updateTemplateLabel();

        var out = document.getElementById("test-result");
        testBtn.disabled = true;
        if (out) out.textContent = "Requête en cours…";
        window.LstjoRuntime.testCatalogSource("chant")
          .then(function (r) {
            if (!out) return;
            if (r.ok) {
              out.textContent =
                "OK HTTP " +
                r.status +
                " — " +
                r.count +
                " entrée(s)\nMode : " +
                r.mode +
                "\napiBase : " +
                r.apiBase +
                "\nURL : " +
                r.url;
            } else {
              out.textContent =
                "Échec\nMode : " +
                (r.mode || "?") +
                "\napiBase : " +
                (r.apiBase || "(vide)") +
                "\nURL : " +
                (r.url || "(vide)") +
                (r.status ? "\nHTTP " + r.status : "") +
                "\n" +
                (r.error || "erreur inconnue");
            }
          })
          .finally(function () {
            testBtn.disabled = false;
          });
      });
    }
  };

  window.Asc.plugin.button = function () {
    var hostEl = document.getElementById("api-host");
    var tokenEl = document.getElementById("api-token");
    var modeEl = document.getElementById("auth-mode");
    if (hostEl) {
      window.LstjoRuntime.setApiHost(hostEl.value);
    }
    if (tokenEl) {
      window.LstjoRuntime.setApiToken(tokenEl.value);
    }
    if (modeEl) {
      window.LstjoRuntime.setAuthMode(modeEl.value);
    }
    if (window.LstjoRuntime.notifySettingsSaved) {
      window.LstjoRuntime.notifySettingsSaved();
    }
    this.executeCommand("close", "");
  };
})();
