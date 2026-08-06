# Les bandes de la famille

Un site privé pour regarder les VHS de famille numérisées, et sa régie pour les
saisir. Deux pages statiques, servies par Cloudflare Pages ; le contenu vit dans
une base Supabase, où la régie l'envoie d'un clic.

## Les fichiers

| Fichier | Rôle |
| --- | --- |
| `index.html` | Le site : frise par année, filtres, trombinoscope, notice, lecteur YouTube. |
| `Regie.dc.html` | La page d'administration : saisie des bandes, des prénoms, des réglages et des textes. |
| `nuage.js` | Le lien avec Supabase : lecture et écriture du catalogue, connexion Google, abonnés. |
| `support.js` | Le moteur de rendu (dc-runtime). Ne pas modifier. |
| `_ds/industry-…/` | Le système de design importé. Ne pas modifier. |

Les deux pages doivent rester **dans le même dossier** : elles se citent l'une
l'autre par un lien relatif et chargent toutes deux `nuage.js`.

## Ouvrir

Il faut servir le dossier en HTTP — un simple double-clic (`file://`) empêche la
régie de lire le fichier du site, et le navigateur cloisonne le stockage local.
N'importe quel serveur statique fait l'affaire :

```bash
npx serve .
```

Puis ouvrez `http://localhost:3000/`.

## En ligne

Le dépôt est publié tel quel par Cloudflare Pages — aucune étape de construction,
aucun dossier de sortie : le contenu de la racine *est* le site.

| | |
| --- | --- |
| Le site | <https://vhs-schaff.pages.dev/> |
| La régie | <https://vhs-schaff.pages.dev/Regie.dc.html> |

Chaque poussée sur `main` déclenche un déploiement. C'est pourquoi le fichier du
site s'appelle `index.html`, en minuscules : c'est ce nom-là que Cloudflare sert à
la racine du domaine.

Une adresse en `.pages.dev` est publique : elle n'est pas listée, mais quiconque
la connaît l'ouvre. Le mot de passe du site est un loquet côté navigateur, pas une
serrure (voir plus bas). `robots.txt` et `_headers` demandent aux moteurs de
recherche de ne pas indexer le site — c'est une politesse qu'ils respectent, pas
une barrière.

## Les codes

| Porte | Réglage | Valeur d'origine |
| --- | --- | --- |
| Le site | `motDePasse` | `famille` |
| La régie | `codeRegie` | `regie` |

Ce sont des loquets côté navigateur : ils écartent les curieux, pas quelqu'un de
déterminé. Changez-les dans **Régie › Réglages**, et ne mettez en ligne que ce que
vous accepteriez de voir circuler. Le contenu du catalogue est lisible par qui
sait interroger la base, mot de passe ou non — gardez le dépôt privé, et les
vidéos YouTube en **non répertorié**.

La connexion Google ne change rien à cela : elle sert à recevoir la lettre, pas à
garder la porte. Pour que l'archive soit réellement fermée, il faudrait exiger un
compte pour lire — c'est un changement des règles de la table `catalogue`, à
demander si vous le souhaitez un jour.

## Ajouter une bande

1. Ouvrez `Regie.dc.html`, entrez le code de la régie.
2. **＋ Nouvelle bande**, remplissez la fiche, collez le lien YouTube.
3. La vignette qui apparaît confirme que le bon lien est collé.

À ce stade, tout est enregistré dans **votre navigateur seulement**. Les autres ne
voient encore rien.

## Publier

**Sauvegarde › Publier maintenant.** C'est tout. Le site est à jour dans la
seconde, pour tout le monde, sans toucher au dépôt.

Publier demande d'être connecté avec Google, et que cette adresse figure dans la
table `admins` de Supabase — le code de la régie n'écarte que les curieux de
votre propre navigateur, il ne prouve rien à la base.

Le panneau **4 · Secours** garde l'ancienne méthode : un bloc à recopier entre
`DONNEES-DEBUT` et `DONNEES-FIN` dans `index.html`. Il ne sert que si Supabase
est indisponible et que vous voulez malgré tout figer le contenu dans le fichier.

## Le nuage

Le catalogue tient en une seule ligne de la table `catalogue` : un document JSON
de la même forme que ce que la régie manipule. Trois tables en tout.

| Table | Qui lit | Qui écrit |
| --- | --- | --- |
| `catalogue` | tout le monde | les adresses listées dans `admins` |
| `admins` | les administrateurs | personne depuis le site (à la main dans Supabase) |
| `abonnes` | soi-même, et les administrateurs | soi-même |

La clé qui figure dans `nuage.js` est publique et faite pour l'être : ce qu'elle
autorise est décidé côté base, par les règles au niveau des lignes. Un visiteur
sans compte peut lire le catalogue et rien d'autre — pas la liste des abonnés,
pas celle des administrateurs, et il ne peut rien écrire.

Le site démarre sur le bloc écrit dans `index.html`, puis la base prend la main
dès qu'elle répond. Si elle ne répond pas, le site reste lisible avec ce bloc :
c'est le filet, et c'est pour ça que le panneau de secours existe.

### Pour que la connexion Google marche

Trois réglages à faire une fois, que je ne peux pas faire à votre place :

1. **Google Cloud Console** → *API et services* → *Identifiants* → créer un
   *ID client OAuth* de type *Application Web*. Dans *URI de redirection
   autorisés*, mettez :
   `https://jjlanebcwttsiechgjzz.supabase.co/auth/v1/callback`
2. **Supabase** → *Authentication* → *Sign In / Providers* → *Google* : collez
   l'ID client et le secret, activez.
3. **Supabase** → *Authentication* → *URL Configuration* : *Site URL* à
   `https://vhs-schaff.pages.dev`, et ajoutez la même adresse dans
   *Redirect URLs*.

Tant que ce n'est pas fait, les pages le voient — elles interrogent
`/auth/v1/settings`, qui liste les fournisseurs actifs — et se taisent : le site
n'affiche pas de bouton mort, et la régie affiche ces trois étapes avec l'adresse
de rappel prête à copier. Personne ne tombe sur la page d'erreur
`Unsupported provider`. Le reste du site fonctionne normalement.

### La lettre

Un visiteur connecté peut cocher qu'il veut recevoir la lettre ; son adresse
part dans `abonnes`. La régie affiche la liste et l'exporte en CSV
(point-virgule, avec BOM pour qu'Excel respecte les accents). L'envoi lui-même
n'est pas dans le site : prenez le CSV et votre outil habituel.

## Les photos

Une image choisie sur le disque est réduite à 720 px, convertie en JPEG et rangée
dans le navigateur. C'est pratique mais lourd : la jauge en haut de la régie vire à
l'ambre puis au rouge en approchant de la limite du navigateur (~4 Mo au total).

Pour un dépôt propre, préférez des adresses d'images : déposez les photos dans le
dossier et renseignez le champ « adresse d'image » avec un chemin relatif. L'option
**sans les photos importées** exclut les images embarquées du bloc publié.

## Sauvegarder

**Sauvegarde › Exporter le JSON** produit un fichier avec tout : bandes, prénoms,
photos, réglages, textes. Rangez-le à côté de vos vidéos. **Importer** le relit.
