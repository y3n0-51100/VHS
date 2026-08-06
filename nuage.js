// ═══════════════════════════════════════════════════════════════════════════
//  Le nuage — tout ce que le site et la régie échangent avec Supabase.
//
//  Les deux pages chargent ce fichier avant leur propre code. Il n'y a rien
//  d'autre à installer : on parle à Supabase en HTTP, avec fetch.
//
//  La clé ci-dessous est publique et faite pour l'être. Ce qu'elle autorise
//  est décidé côté base, par les règles de sécurité au niveau des lignes :
//  lire le catalogue, oui ; l'écrire, seulement si le compte connecté figure
//  dans la table « admins ». Personne ne peut lire la liste des abonnés sauf
//  vous. Voir README, section « Le nuage ».
// ═══════════════════════════════════════════════════════════════════════════

(function (global) {
  "use strict";

  const URL_BASE = "https://jjlanebcwttsiechgjzz.supabase.co";
  const CLE_PUBLIQUE = "sb_publishable_WQ_HMeMxiduQMC4po_j-tw_S-CI0xdP";

  const CLE_SESSION = "bandes-famille-session";

  // ── Session ──────────────────────────────────────────────────────────────
  // On garde le jeton dans le navigateur. Il expire ; on le renouvelle avec le
  // jeton de rafraîchissement, qui lui dure jusqu'à la déconnexion.

  function sessionRangee() {
    try {
      const brut = localStorage.getItem(CLE_SESSION);
      return brut ? JSON.parse(brut) : null;
    } catch (e) { return null; }
  }

  function rangerSession(s) {
    try {
      if (s) localStorage.setItem(CLE_SESSION, JSON.stringify(s));
      else localStorage.removeItem(CLE_SESSION);
    } catch (e) {}
  }

  function expiree(s) {
    // On renouvelle une minute avant l'échéance, pour ne pas courir après.
    return !s || !s.expire_le || Date.now() > (s.expire_le - 60000);
  }

  function sessionDepuis(charge) {
    if (!charge || !charge.access_token) return null;
    const duree = Number(charge.expires_in || 3600) * 1000;
    return {
      access_token: charge.access_token,
      refresh_token: charge.refresh_token || "",
      expire_le: Date.now() + duree,
      utilisateur: charge.user ? profil(charge.user) : (sessionRangee() || {}).utilisateur || null
    };
  }

  function profil(u) {
    const m = (u && u.user_metadata) || {};
    return {
      id: u.id,
      email: u.email || "",
      nom: m.full_name || m.name || (u.email || "").split("@")[0],
      avatar: m.avatar_url || m.picture || ""
    };
  }

  // Récupère les jetons que Supabase renvoie dans le fragment de l'adresse
  // après un aller-retour chez Google, puis nettoie la barre d'adresse.
  function recupererRetourGoogle() {
    const frag = global.location.hash || "";
    if (frag.indexOf("access_token=") < 0 && frag.indexOf("error") < 0) return null;

    const p = new URLSearchParams(frag.replace(/^#/, ""));
    const propre = global.location.pathname + global.location.search;
    try { global.history.replaceState(null, "", propre); } catch (e) {}

    if (p.get("error") || p.get("error_description")) {
      return { erreur: p.get("error_description") || p.get("error") };
    }
    if (!p.get("access_token")) return null;

    const s = sessionDepuis({
      access_token: p.get("access_token"),
      refresh_token: p.get("refresh_token"),
      expires_in: p.get("expires_in")
    });
    rangerSession(s);
    return { session: s };
  }

  async function rafraichir(s) {
    if (!s || !s.refresh_token) return null;
    const r = await fetch(URL_BASE + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { apikey: CLE_PUBLIQUE, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: s.refresh_token })
    });
    if (!r.ok) { rangerSession(null); return null; }
    const neuve = sessionDepuis(await r.json());
    rangerSession(neuve);
    return neuve;
  }

  // Renvoie une session utilisable, ou null. C'est le seul point d'entrée :
  // tout le reste part de là.
  async function session() {
    let s = sessionRangee();
    if (!s) return null;
    if (expiree(s)) s = await rafraichir(s);
    if (!s) return null;
    if (!s.utilisateur) {
      const u = await utilisateurDistant(s);
      if (!u) { rangerSession(null); return null; }
      s.utilisateur = u;
      rangerSession(s);
    }
    return s;
  }

  async function utilisateurDistant(s) {
    const r = await fetch(URL_BASE + "/auth/v1/user", {
      headers: { apikey: CLE_PUBLIQUE, Authorization: "Bearer " + s.access_token }
    });
    if (!r.ok) return null;
    return profil(await r.json());
  }

  // Supabase publie la liste de ses fournisseurs actifs. On la consulte avant
  // d'envoyer qui que ce soit chez Google : tant que le fournisseur n'est pas
  // activé dans le tableau de bord, l'aller-retour se termine sur une page de
  // JSON brut — « Unsupported provider » — que personne ne devrait voir.
  let _reglagesAuth = null;
  async function reglagesAuth() {
    if (_reglagesAuth) return _reglagesAuth;
    try {
      const r = await fetch(URL_BASE + "/auth/v1/settings", { headers: { apikey: CLE_PUBLIQUE } });
      _reglagesAuth = r.ok ? await r.json() : { external: {} };
    } catch (e) {
      _reglagesAuth = { external: {} };
    }
    return _reglagesAuth;
  }

  async function googleActif() {
    const s = await reglagesAuth();
    return !!(s && s.external && s.external.google);
  }

  async function connexionGoogle(retour) {
    if (!(await googleActif())) {
      throw new Error("La connexion Google n'est pas encore activée côté Supabase.");
    }
    const dest = retour || (global.location.origin + global.location.pathname);
    global.location.href = URL_BASE + "/auth/v1/authorize?provider=google&redirect_to=" +
      encodeURIComponent(dest);
  }

  async function deconnexion() {
    const s = sessionRangee();
    if (s && s.access_token) {
      try {
        await fetch(URL_BASE + "/auth/v1/logout", {
          method: "POST",
          headers: { apikey: CLE_PUBLIQUE, Authorization: "Bearer " + s.access_token }
        });
      } catch (e) {}
    }
    rangerSession(null);
  }

  // ── Appels à la base ─────────────────────────────────────────────────────

  function entetes(s, extra) {
    const h = Object.assign({ apikey: CLE_PUBLIQUE, "Content-Type": "application/json" }, extra || {});
    if (s && s.access_token) h.Authorization = "Bearer " + s.access_token;
    return h;
  }

  async function lireCatalogue() {
    const r = await fetch(URL_BASE + "/rest/v1/catalogue?select=donnees,maj&id=eq.1", {
      headers: { apikey: CLE_PUBLIQUE, Accept: "application/vnd.pgrst.object+json" },
      cache: "no-store"
    });
    if (!r.ok) throw new Error("lecture du catalogue : " + r.status);
    const ligne = await r.json();
    return ligne && ligne.donnees ? ligne.donnees : null;
  }

  // Écrit le catalogue. Échoue si le compte connecté n'est pas administrateur —
  // c'est la base qui refuse, pas le navigateur.
  async function ecrireCatalogue(donnees) {
    const s = await session();
    if (!s) throw new Error("connexion requise");
    const r = await fetch(URL_BASE + "/rest/v1/catalogue?id=eq.1", {
      method: "PATCH",
      headers: entetes(s, { Prefer: "return=representation" }),
      body: JSON.stringify({
        donnees: donnees,
        maj: new Date().toISOString(),
        modifie_par: s.utilisateur ? s.utilisateur.email : null
      })
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      throw new Error(r.status === 401 || r.status === 403
        ? "ce compte n'a pas le droit de publier"
        : "publication refusée (" + r.status + ") " + detail);
    }
    const lignes = await r.json();
    // PostgREST renvoie une liste vide quand aucune ligne n'a passé les règles :
    // la requête « réussit » sans avoir rien écrit. On le traite comme un refus.
    if (!Array.isArray(lignes) || lignes.length === 0) {
      throw new Error("ce compte n'a pas le droit de publier");
    }
    return lignes[0];
  }

  async function estAdmin() {
    const s = await session();
    if (!s) return false;
    try {
      const r = await fetch(URL_BASE + "/rest/v1/rpc/est_admin", {
        method: "POST", headers: entetes(s), body: "{}"
      });
      if (!r.ok) return false;
      return (await r.json()) === true;
    } catch (e) { return false; }
  }

  // ── La lettre ────────────────────────────────────────────────────────────

  async function monAbonnement() {
    const s = await session();
    if (!s) return null;
    const r = await fetch(URL_BASE + "/rest/v1/abonnes?select=user_id,email,nom,consenti_le", {
      headers: entetes(s), cache: "no-store"
    });
    if (!r.ok) return null;
    const l = await r.json();
    return Array.isArray(l) && l.length ? l[0] : null;
  }

  async function abonner() {
    const s = await session();
    if (!s || !s.utilisateur) throw new Error("connexion requise");
    const r = await fetch(URL_BASE + "/rest/v1/abonnes", {
      method: "POST",
      headers: entetes(s, { Prefer: "resolution=merge-duplicates,return=representation" }),
      body: JSON.stringify({
        user_id: s.utilisateur.id,
        email: s.utilisateur.email,
        nom: s.utilisateur.nom,
        consenti_le: new Date().toISOString()
      })
    });
    if (!r.ok) throw new Error("abonnement refusé (" + r.status + ")");
    return true;
  }

  async function desabonner() {
    const s = await session();
    if (!s || !s.utilisateur) throw new Error("connexion requise");
    const r = await fetch(URL_BASE + "/rest/v1/abonnes?user_id=eq." + encodeURIComponent(s.utilisateur.id), {
      method: "DELETE", headers: entetes(s)
    });
    if (!r.ok) throw new Error("désabonnement refusé (" + r.status + ")");
    return true;
  }

  // Réservé à l'administrateur : les règles de la base filtrent d'elles-mêmes.
  async function listerAbonnes() {
    const s = await session();
    if (!s) return [];
    const r = await fetch(URL_BASE + "/rest/v1/abonnes?select=email,nom,consenti_le&order=consenti_le.desc", {
      headers: entetes(s), cache: "no-store"
    });
    if (!r.ok) return [];
    const l = await r.json();
    return Array.isArray(l) ? l : [];
  }

  global.Nuage = {
    URL_BASE: URL_BASE,
    session: session,
    recupererRetourGoogle: recupererRetourGoogle,
    googleActif: googleActif,
    connexionGoogle: connexionGoogle,
    deconnexion: deconnexion,
    lireCatalogue: lireCatalogue,
    ecrireCatalogue: ecrireCatalogue,
    estAdmin: estAdmin,
    monAbonnement: monAbonnement,
    abonner: abonner,
    desabonner: desabonner,
    listerAbonnes: listerAbonnes
  };
})(window);
