(function () {
  "use strict";

  window.Asc.plugin.init = function () {
    var hostEl = document.getElementById("api-host");
    var tokenEl = document.getElementById("api-token");
    var tplEl = document.getElementById("template-label");
    if (hostEl) {
      hostEl.value = window.LstjoRuntime.getApiHost();
    }
    if (tokenEl) {
      tokenEl.value = window.LstjoRuntime.getApiToken();
    }
    if (tplEl) {
      var path = window.LstjoRuntime.getApiPath();
      var tpl = window.LstjoRuntime.getSourceUrlTemplate();
      tplEl.textContent =
        "Modèle source : " +
        tpl +
        " — apiBase = {hôte}" +
        path +
        " (ex. source « chant » → …/api/chant?token=…)";
    }
  };

  window.Asc.plugin.button = function () {
    var hostEl = document.getElementById("api-host");
    var tokenEl = document.getElementById("api-token");
    if (hostEl) {
      window.LstjoRuntime.setApiHost(hostEl.value);
    }
    if (tokenEl) {
      window.LstjoRuntime.setApiToken(tokenEl.value);
    }
    this.executeCommand("close", "");
  };
})();
