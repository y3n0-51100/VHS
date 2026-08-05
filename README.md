# Les bandes de la famille

Un site privé pour regarder les VHS de famille numérisées, et sa régie pour les
saisir. Deux pages, aucun serveur, aucune base de données : tout le contenu tient
dans un bloc de données au bas du fichier du site.

## Les fichiers

| Fichier | Rôle |
| --- | --- |
| `index.html` | Le site : frise par année, filtres, trombinoscope, notice, lecteur YouTube. |
| `Regie.dc.html` | La page d'administration : saisie des bandes, des prénoms, des réglages et des textes. |
| `support.js` | Le moteur de rendu (dc-runtime). Ne pas modifier. |
| `_ds/industry-…/` | Le système de design importé. Ne pas modifier. |

Les deux pages doivent rester **dans le même dossier** : elles se citent l'une
l'autre par un lien relatif, et la régie lit le fichier du site pour connaître le
contenu publié.

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
déterminé. Changez-les dans **Régie › Réglages**, et ne mettez sur ce dépôt que ce
que vous accepteriez de voir circuler. Si le dépôt est public, tout le monde peut
lire les mots de passe et les liens dans le code source — gardez-le privé, et les
vidéos YouTube en **non répertorié**.

## Ajouter une bande

1. Ouvrez `Regie.dc.html`, entrez le code de la régie.
2. **＋ Nouvelle bande**, remplissez la fiche, collez le lien YouTube.
3. La vignette qui apparaît confirme que le bon lien est collé.

À ce stade, tout est enregistré dans **votre navigateur seulement**. Les autres ne
voient encore rien.

## Publier

1. **Sauvegarde › Fabriquer le bloc**, puis **Copier**.
2. Ouvrez `index.html` dans un éditeur.
3. Remplacez tout ce qui va du marqueur `DONNEES-DEBUT` au marqueur `DONNEES-FIN`,
   marqueurs compris, par ce que vous venez de copier.
4. Commitez, poussez.

Le site compare les dates : votre brouillon local ne s'affiche que s'il est plus
récent que le bloc publié. Une fois le bloc recopié, c'est lui qui fait foi — un
vieux brouillon ne peut pas masquer ce que vous venez de publier.

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
