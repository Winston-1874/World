# Multijoueur autoritaire — proposition du 14 novembre 2026

Statut : architecture validée le 14 novembre 2026 (« OK go proto avance »).
Réalisation autorisée des étapes 2 et 3 ; aucun déploiement ni fusion automatique.

## But

Une seule simulation décide du monde partagé. Un navigateur lent ou suspendu
retrouve l'état du serveur au lieu de rejouer tous les tours manqués. Le solo
reste utilisable par double-clic sur `index.html`, avec les mêmes règles et bots.

## Alternatives

1. Consolider le lockstep actuel : faible changement, mais chaque navigateur
   continue de calculer la partie ; le rattrapage et les divergences subsistent.
2. Simulation autoritaire isolée par partie : coût serveur supérieur, mais une
   seule vérité et des clients qui reçoivent l'état. Architecture retenue et validée.
3. Réécrire le moteur dans un autre langage : deux implémentations à maintenir,
   risque de règles divergentes ; écarté.

## Proposition concrète

- Charger les scripts de règles existants, sans copie ni compilation du client.
  D'abord établir un banc de tests Node avec des sorties graphiques explicites
  neutralisées ; ensuite remplacer les effets d'affichage par des événements
  destinés au joueur concerné. Ne pas confondre `human` (règle) et `isHuman`
  (point de vue local). Les scénarios restent solo dans cette première version.
- Un processus enfant par partie, un superviseur HTTP/WebSocket. Un plantage
  ou un calcul long ne doit pas bloquer les autres salons. Une limite de tas V8
  ne constitue pas une limite de RSS : documenter et mesurer les deux.
- Protocole version 2 explicite, expérimental et activé par configuration.
  Ne pas modifier silencieusement le protocole lockstep version 1.
- État initial contenant carte, royaumes, bâtiments, armées, diplomatie,
  travaux et reliques. Schéma de données explicite ; exclure fonctions et caches
  internes. Tableaux binaires pour la carte, données structurées pour les objets.
- Modifications regroupées à cadence bornée, avec numéro de partie, version de
  schéma, séquence et séquence de base. Un client n'applique une modification que
  sur sa base exacte ; sinon il demande un nouvel état complet. Aucun calcul de
  règles ni IA dans le navigateur en mode autoritaire.
- Le serveur attribue la place du joueur à sa connexion. Ordres validés en forme
  puis par les règles ; numéros monotones et accusés de réception pour éviter
  une double exécution. Les ordres internes restent interdits au client.
- Reconnexion : jeton aléatoire par place, mémoire seulement, délai proposé de
  60 secondes. Le royaume conserve son état durant ce délai, puis devient bot.
  Retour dans le même royaume avec un état complet ; aucune continuation solo
  silencieuse pendant une coupure du mode autoritaire.
- Ressources bornées : connexions, salons, parties actives, ordres, fragments,
  messages, files de sortie et reprises d'état. Refuser une partie supplémentaire
  avant de créer son processus. Arrêter une partie vide après le délai de reprise.
- Commencer les essais avec deux parties simultanées ; le nombre admissible sur
  2 vCPU/4 Go puis 4 vCPU/8 Go dépendra de mesures incluant la diffusion.

## Livraison par étapes

1. Banc de tests sans affichage et benchmark déterministe sur Node maintenu ;
   correction des bornes du relais avec tests de non-régression. Aucun changement
   de règles ou d'interface et aucune prétention de serveur autoritaire à ce stade.
2. Après validation de cette proposition : isolation de la simulation, schéma
   d'état, codec complet/différentiel et tests de reconstruction exacte.
3. Adaptateur navigateur, reconnexion, essais de deux navigateurs réels avec un
   onglet suspendu, langues française/anglaise, puis charge avec 16 joueurs.

## Critères d'acceptation du mode autoritaire

- Deux clients reconstruisent exactement les champs publiés du serveur après
  actions, bots, perte de séquence et reconnexion ; comparer les tableaux entiers,
  pas seulement `Game.stateHash()` qui échantillonne la carte.
- L'onglet qui revient reçoit un état récent sans simuler les tours manqués.
- Un client lent est déconnecté de façon bornée sans bloquer les autres.
- Un processus de partie arrêté ne détruit ni le superviseur ni une autre partie.
- Le solo par fichier et les règles restent inchangés ; tests et recette réelle.
- Mesurer génération, simulation, sérialisation, octets transmis, RSS, CPU et
  retard de boucle séparément. Ne pas conclure sur l'hébergement à partir de la
  seule moyenne de simulation. Aucun déploiement dans ce chantier.
