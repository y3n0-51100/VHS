# Flow Automation – Prompts d'images

Extension Chrome (Manifest V3) qui envoie une file de prompts d'images à Google Flow,
attend chaque génération, télécharge les images puis passe au prompt suivant.

## Installation

1. `chrome://extensions` → activer le **mode développeur**.
2. **Charger l'extension non empaquetée** → choisir le dossier `flow-automation`.
3. Épingler l'icône ; un clic ouvre le panneau latéral.

## Utilisation

1. Ouvrir un projet sur <https://labs.google/fx/tools/flow> et régler Flow en mode **Image**
   (modèle, format, nombre d'images) comme d'habitude.
2. Dans le panneau : coller les prompts (1 par ligne, séparés par une ligne vide ou par `---`)
   ou importer un `.txt` / `.json` (tableau de chaînes ou d'objets JSON).
3. **Tester** encadre le champ (bleu) et le bouton (vert) détectés dans Flow.
4. **Démarrer**. Les images arrivent dans `Téléchargements/<dossier>/001_mon-prompt_1.png`.

Si Flow change son interface et que la détection échoue, renseigner les sélecteurs CSS
du champ et du bouton dans **Réglages**.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `manifest.json` | Déclaration de l'extension. |
| `background.js` | Stockage centralisé de la file (verrou) et téléchargements. |
| `content.js` | Pilote la page Flow : saisie, clic, attente des images, reprise après rechargement. |
| `sidepanel/` | Panneau latéral : file d'attente, contrôles, réglages, journal. |
