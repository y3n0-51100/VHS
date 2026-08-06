// ═══════════════════════════════════════════════════════════════════════════
//  envoyer-lettre — expédie la lettre écrite dans la régie.
//
//  Tourne chez Supabase, pas dans le navigateur. Trois raisons :
//   · la clé du service d'envoi n'a rien à faire dans une page publique ;
//   · la liste des abonnés ne descend jamais jusqu'au client ;
//   · un envoi par destinataire, donc personne ne voit l'adresse des autres.
//
//  Secrets attendus (Supabase › Edge Functions › Secrets) :
//   · BREVO_API_KEY   ou   RESEND_API_KEY   — un seul des deux suffit
//   · LETTRE_EXPEDITEUR       l'adresse d'envoi, vérifiée chez le prestataire
//   · LETTRE_EXPEDITEUR_NOM   facultatif, le nom affiché
// ═══════════════════════════════════════════════════════════════════════════

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (corps: unknown, statut = 200) =>
  new Response(JSON.stringify(corps), {
    status: statut,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

type Abonne = { email: string; nom: string | null };

// ── Les prestataires ───────────────────────────────────────────────────────
// Chacun veut un format différent ; le reste du code n'en sait rien.

async function envoyerBrevo(
  cle: string, de: { email: string; nom: string },
  a: Abonne, objet: string, texte: string,
): Promise<string | null> {
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": cle, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: de.email, name: de.nom },
      to: [{ email: a.email, name: a.nom || undefined }],
      subject: objet,
      textContent: texte,
    }),
  });
  return r.ok ? null : `${r.status} ${(await r.text()).slice(0, 200)}`;
}

async function envoyerResend(
  cle: string, de: { email: string; nom: string },
  a: Abonne, objet: string, texte: string,
): Promise<string | null> {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${de.nom} <${de.email}>`,
      to: [a.email],
      subject: objet,
      text: texte,
    }),
  });
  return r.ok ? null : `${r.status} ${(await r.text()).slice(0, 200)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erreur: "méthode non gérée" }, 405);

  const URL_SB = Deno.env.get("SUPABASE_URL")!;
  const CLE_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const CLE_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const autorisation = req.headers.get("Authorization") || "";
  if (!autorisation.startsWith("Bearer ")) return json({ erreur: "connexion requise" }, 401);

  // ── 1. Qui appelle, et a-t-il le droit ? ────────────────────────────────
  // On interroge est_admin() avec le jeton de l'appelant : c'est la base qui
  // tranche, avec ses propres règles, et non un test fait ici.
  const rAdmin = await fetch(`${URL_SB}/rest/v1/rpc/est_admin`, {
    method: "POST",
    headers: { apikey: CLE_ANON, Authorization: autorisation, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!rAdmin.ok || (await rAdmin.json()) !== true) {
    return json({ erreur: "ce compte n'a pas le droit d'envoyer la lettre" }, 403);
  }

  // ── 2. La lettre ────────────────────────────────────────────────────────
  let corps: { objet?: string; texte?: string; essai?: boolean };
  try { corps = await req.json(); } catch { return json({ erreur: "corps illisible" }, 400); }

  const objet = (corps.objet || "").trim();
  const texte = (corps.texte || "").trim();
  if (!objet) return json({ erreur: "il manque l'objet" }, 400);
  if (!texte) return json({ erreur: "il manque le texte" }, 400);

  // ── 3. Le prestataire ───────────────────────────────────────────────────
  const cleBrevo = Deno.env.get("BREVO_API_KEY");
  const cleResend = Deno.env.get("RESEND_API_KEY");
  const expediteur = Deno.env.get("LETTRE_EXPEDITEUR");
  const nomExpediteur = Deno.env.get("LETTRE_EXPEDITEUR_NOM") || "Les bandes de la famille";

  if (!cleBrevo && !cleResend) {
    return json({ erreur: "aucun service d'envoi configuré (BREVO_API_KEY ou RESEND_API_KEY)" }, 503);
  }
  if (!expediteur) {
    return json({ erreur: "LETTRE_EXPEDITEUR manque : l'adresse d'envoi vérifiée chez le prestataire" }, 503);
  }
  const de = { email: expediteur, nom: nomExpediteur };
  const envoyer = cleBrevo
    ? (a: Abonne) => envoyerBrevo(cleBrevo, de, a, objet, texte)
    : (a: Abonne) => envoyerResend(cleResend!, de, a, objet, texte);

  // ── 4. Les destinataires ────────────────────────────────────────────────
  // Lus ici avec la clé de service : la liste ne descend jamais au navigateur.
  const rAbonnes = await fetch(`${URL_SB}/rest/v1/abonnes?select=email,nom`, {
    headers: { apikey: CLE_SERVICE, Authorization: `Bearer ${CLE_SERVICE}` },
  });
  if (!rAbonnes.ok) return json({ erreur: "liste des abonnés illisible" }, 500);
  const abonnes: Abonne[] = await rAbonnes.json();

  if (!abonnes.length) return json({ erreur: "aucun abonné" }, 400);

  // Un essai n'écrit qu'à l'auteur : on vérifie la mise en page avant
  // d'envoyer à toute la famille.
  if (corps.essai) {
    const rMoi = await fetch(`${URL_SB}/auth/v1/user`, {
      headers: { apikey: CLE_ANON, Authorization: autorisation },
    });
    if (!rMoi.ok) return json({ erreur: "compte illisible" }, 401);
    const moi = await rMoi.json();
    const echec = await envoyer({ email: moi.email, nom: "essai" });
    return echec
      ? json({ erreur: `essai refusé par le prestataire : ${echec}` }, 502)
      : json({ essai: true, destinataire: moi.email });
  }

  // ── 5. Un message par personne ──────────────────────────────────────────
  let envoyes = 0;
  const echecs: { email: string; raison: string }[] = [];
  for (const a of abonnes) {
    const echec = await envoyer(a);
    if (echec) echecs.push({ email: a.email, raison: echec });
    else envoyes++;
  }

  return json({ envoyes, total: abonnes.length, echecs });
});
