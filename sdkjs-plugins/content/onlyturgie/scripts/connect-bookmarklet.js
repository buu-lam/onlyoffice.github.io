/*
 * Favori « ⛪ Connecter Onlyturgie ».
 * Source unique : onlyoffice.github.io/sdkjs-plugins/content/onlyturgie/scripts/connect-bookmarklet.js
 * Copie identique : liturgie/js/onlyturgie-connect.js (page d'accueil de l'app Liturgie).
 *
 * Le favori s'exécute sur la page Nextcloud où un document OnlyOffice est ouvert :
 *  1. demande un jeton personnel à l'app Liturgie (session Nextcloud) ;
 *  2. l'envoie au plugin Onlyturgie s'il est déjà installé ;
 *  3. sinon, si le Gestionnaire de modules est ouvert, lui demande d'installer Onlyturgie
 *     depuis GitHub Pages (pas besoin d'ajouter le magasin en mode développeur), puis réessaie.
 */
(function () {
  'use strict';

  function onlyturgieBookmarklet() {
    var PLUGIN_BASE = "https://buu-lam.github.io/onlyoffice.github.io/sdkjs-plugins/content/onlyturgie/";
    var OCg = window.OC;
    if (!OCg || !OCg.generateUrl) {
      alert("Onlyturgie : ouvrez d’abord un document dans Nextcloud, puis recliquez sur ce favori.");
      return;
    }
    function broadcast(msg) {
      (function walk(w, depth) {
        try { w.postMessage(msg, "*"); } catch (e) {}
        if (depth > 6) return;
        for (var i = 0; i < w.frames.length; i++) {
          try { walk(w.frames[i], depth + 1); } catch (e2) {}
        }
      })(window, 0);
    }
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function sendSetup(setup, ms) {
      var acks = 0;
      var onAck = function (e) {
        if (e.data && e.data.type === "onlyturgie:setup-ack" && e.data.ok) acks++;
      };
      window.addEventListener("message", onAck);
      broadcast(setup);
      return wait(ms).then(function () {
        window.removeEventListener("message", onAck);
        return acks > 0;
      });
    }
    function install(serverCfg) {
      // Config fournie par Liturgie (la CSP Nextcloud bloque en général l'accès direct à github.io).
      var get = serverCfg
        ? Promise.resolve(serverCfg)
        : fetch(PLUGIN_BASE + "config.json?_=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.json(); });
      return get
        .then(function (cfg) {
          cfg.baseUrl = PLUGIN_BASE;
          cfg.url = PLUGIN_BASE + "config.json";
          // Message attendu par le Gestionnaire de modules (store/plugin/scripts/code.js, type « install »).
          broadcast(JSON.stringify({ type: "install", url: cfg.url, guid: cfg.guid, config: cfg }));
        });
    }

    var user = "";
    fetch(OCg.generateUrl("/apps/liturgie/api/onlyturgie-token"), {
      credentials: "same-origin",
      headers: { requesttoken: OCg.requestToken || "", Accept: "application/json" }
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || !res.j.token) throw new Error((res.j && res.j.error) || "accès refusé.");
        user = res.j.user;
        var setup = { type: "onlyturgie:setup", apiHost: res.j.apiHost, token: res.j.token };
        return sendSetup(setup, 1500).then(function (ok) {
          if (ok) return "connected";
          return install(res.j.pluginConfig)
            .then(function () { return wait(4000); })
            .then(function () { return sendSetup(setup, 2500); })
            .then(function (ok2) { return ok2 ? "installed" : "missing"; });
        });
      })
      .then(function (state) {
        if (state === "connected") {
          alert("Onlyturgie est connecté (compte " + user + "). Fermez puis rouvrez le panneau Onlyturgie.");
        } else if (state === "installed") {
          alert("Onlyturgie est installé et connecté (compte " + user + "). Fermez le Gestionnaire de modules : le bouton Onlyturgie est dans l’onglet Modules complémentaires.");
        } else {
          alert("Onlyturgie ne répond pas encore.\n\n" +
            "• Si le Gestionnaire de modules n’était pas ouvert : ouvrez-le (onglet « Modules complémentaires »), laissez-le ouvert et recliquez sur ce favori.\n" +
            "• S’il était ouvert : Onlyturgie vient sans doute d’être installé. Rechargez la page (F5), puis recliquez sur ce favori une fois le document chargé.");
        }
      })
      .catch(function (err) {
        alert("Onlyturgie : " + (err && err.message ? err.message : "impossible de joindre Nextcloud. Êtes-vous connecté ?"));
      });
  }

  /** Remise à zéro (tests de bout en bout) : efface la config du plugin et demande sa désinstallation. */
  function onlyturgieReset() {
    var GUID = "asc.{F7A4C9AF-2D3B-4C8C-A8D9-2F3A4B5C6D7E}";
    var acks = 0;
    var onAck = function (e) {
      if (e.data && e.data.type === "onlyturgie:reset-ack" && e.data.ok) acks++;
    };
    function broadcast(msg) {
      (function walk(w, depth) {
        try { w.postMessage(msg, "*"); } catch (e) {}
        if (depth > 6) return;
        for (var i = 0; i < w.frames.length; i++) {
          try { walk(w.frames[i], depth + 1); } catch (e2) {}
        }
      })(window, 0);
    }
    window.addEventListener("message", onAck);
    broadcast({ type: "onlyturgie:reset" });
    // Désinstallation : reçue seulement si le Gestionnaire de modules est ouvert.
    broadcast(JSON.stringify({ type: "remove", guid: GUID, backup: false }));
    setTimeout(function () {
      window.removeEventListener("message", onAck);
      alert((acks ? "Configuration Onlyturgie effacée.\n" : "Onlyturgie n’a pas répondu (déjà absent ou désactivé).\n") +
        "Si le Gestionnaire de modules était ouvert, Onlyturgie y a été désinstallé.\nRechargez la page pour repartir de zéro.");
    }, 2000);
  }

  function init() {
    var connectBtns = document.querySelectorAll('[data-onlyturgie-connect]');
    for (var c = 0; c < connectBtns.length; c++) {
      connectBtns[c].addEventListener('click', function (e) { e.preventDefault(); onlyturgieBookmarklet(); });
    }
    var resetBtns = document.querySelectorAll('[data-onlyturgie-reset]');
    for (var r = 0; r < resetBtns.length; r++) {
      resetBtns[r].addEventListener('click', function (e) { e.preventDefault(); onlyturgieReset(); });
    }
    var links = document.querySelectorAll('[data-onlyturgie-bookmarklet]');
    var href = 'javascript:(' + encodeURIComponent(onlyturgieBookmarklet.toString()) + ')();void 0';
    for (var i = 0; i < links.length; i++) {
      links[i].setAttribute('href', href);
      links[i].addEventListener('click', function (e) {
        e.preventDefault();
        alert('Ne cliquez pas ici : faites glisser ce bouton dans votre barre de favoris.');
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
