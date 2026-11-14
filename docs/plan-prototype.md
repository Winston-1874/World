# Plan d'exécution du prototype autoritaire

Spécification : [multijoueur-autoritaire.md](multijoueur-autoritaire.md), approuvée.
Exécution dans la branche dédiée existante, sans nouvelle demande d'approbation.
Scripts classiques, Node 24, aucune dépendance du jeu, textes FR/EN.

## 1. État partagé et moteur sans affichage

- [x] `js/etat.js` : schéma explicite, données structurées et tableaux binaires ;
  `capturer`, `encoder`, `appliquer`, avec version, identifiant de partie et base.
- [x] `serveur/moteur.cjs` : chargement des scripts réels dans une VM par processus,
  commandes validées avant `Game.runOrder`, effets de présentation séparés.
- [x] Tests : état initial et changements exacts, Maps/Sets, flottants,
  base incorrecte rejetée sans mutation, ordres frauduleux refusés.

## 2. Processus et transport

- [x] `serveur/partie.cjs` : une simulation par processus enfant ; cadence fixe,
  publication 5 Hz, snapshots binaires compressés, statistiques séparées.
- [x] `serveur/autoritaire.cjs` : salons, admission (2 parties par défaut), enfants,
  commandes séquencées, reprise par jeton pendant 60 s, extinction des parties vides.
- [x] `serveur/serveur.js` : sélection explicite par `AUTHORITATIVE=1`, transport
  borné commun ; fragments sortants acquittés, un transfert en vol par client.
- [x] Tests : deux parties indépendantes, enfant arrêté, refus de surcharge,
  replay d'ordre, reprise et expiration, client lent, séquence manquante.

## 3. Navigateur et recette

- [x] `js/net-authoritative.js`, `js/main.js`, `index.html` : sélection
  explicite `?autoritaire=1`, installation de l'état sans `Game.init/update/runOrder`,
  rafraîchissement du rendu, résultats d'ordres et demandes d'alliance ciblées.
- [x] Bloquer les commandes pendant la reprise ; aucune continuation solo sur coupure.
- [x] Deux contextes Chromium réels : FR/EN, ordres, gel/reprise, déconnexion,
  reconstruction identique ; contrôle solo par `file://` ; captures du jeu.
- [x] Essai 16 clients ; mémoire, simulation, sérialisation, diffusion et cadence.
- [x] Documenter résultats, limites et commandes ; revue manuelle, commits et mise à jour PR #1.

Points de revue : flux interrompu en milieu d'état ; commande rejouée après coupure ;
ancien socket remplacé ; action sur un royaume/case inexistant ; échec de génération.
La couverture des tests et de la recette est détaillée dans le rapport de validation.

Recette et mesures : [validation-autoritaire.md](validation-autoritaire.md).
La tentative de revue Mistral a expiré sans résultat ; aucune revue indépendante validée.
