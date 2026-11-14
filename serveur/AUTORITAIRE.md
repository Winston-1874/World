# Prototype autoritaire — protocole 2

## Essayer

Node 24, aucune dépendance serveur ou jeu :

```sh
AUTHORITATIVE=1 node serveur/serveur.js
```

Ouvrir `http://localhost:8080/?autoritaire=1` dans deux navigateurs, créer un salon,
rejoindre son code puis lancer. L'écoute reste sur `127.0.0.1` ; aucun service
public n'est configuré par ce projet. Le serveur et les deux navigateurs doivent
tous choisir la version 2. Sans ces options, le relais historique reste disponible.
Le solo utilise toujours les mêmes scripts par double-clic sur `index.html`.

## Exécution et état

Le superviseur conserve les salons et les connexions. Il lance `partie.cjs` dans
un processus enfant par partie. `moteur.cjs` charge les scripts réels, dans leur
ordre HTML, avec les sorties graphiques neutralisées. `simulation.cjs` valide
les ordres puis appelle les règles existantes. Les bots et le replay tournent
dans ce processus. Aucun moteur simplifié ni copie des règles.

La simulation vise 10 tours/s à vitesse ×1, 30 à ×3. Elle publie au maximum
5 états/s. Un passage de boucle rattrape au plus trois tours ; la dette de temps
est plafonnée à deux secondes. Sous surcharge, le temps du jeu ralentit.
La génération bloque uniquement le processus de la partie concernée.

`js/etat.js` est le codec partagé. Son schéma 1 énumère les données publiées :
carte, royaumes, armées, bâtiments, travaux, diplomatie, reliques, etc. Les
fonctions, le générateur aléatoire et les caches restent côté serveur.
Les objets, Maps et Sets sont encodés dans un en-tête JSON ; les tableaux typés
gardent leurs octets et leur type. Les nombres non finis et `undefined` ont un
encodage explicite. Les tableaux sont transmis complets au départ, puis sous
forme de plages d'octets modifiés ; les objets structurés sont renvoyés entiers.
Chaque publication produit un paquet complet et un différentiel, compressés
en gzip niveau 1 et partagés entre les connexions.

Le navigateur reconstruit une base réseau séparée des données d'affichage.
Il vérifie partie, protocole, schéma, séquence, base exacte, tailles et contenu
des tableaux. Il installe ensuite l'état atomiquement et invalide les caches
visuels. `Game.init`, `Game.update` et `Game.runOrder` ne s'exécutent pas dans le
client autoritaire. Les noms automatiques se localisent côté affichage.

## Messages et reprise

Les commandes JSON de salon conservent les noms du protocole 1. La négociation
est `hello {protocol:2,name,banner,langue}`. `start` ajoute identifiant de partie,
place, jeton de reprise, délai et dernier numéro d'ordre reçu ; ce message part
avant la génération pour permettre une coupure dès le démarrage.

- `order {s,o}` : numéro strictement croissant ; le serveur attribue la place.
  Forme, indices réels, demande d'alliance préalable et règles sont vérifiés.
  Les 32 derniers résultats de chaque place sont inclus dans les états.
  Le navigateur limite ses ordres en attente à 32 ; les callbacks se déclenchent
  après installation de l'état correspondant. Rejouer un numéro ne rejoue pas l'action.
- `state {transfer,seq,bytes,compression:"gzip"}` annonce un transfert, suivi
  de messages WebSocket binaires de 32 Kio au maximum. `stateAck {transfer,index}`
  autorise le morceau suivant. Le dernier acquittement confirme la reconstruction.
  Un seul transfert est en vol par connexion. À son terme, le superviseur choisit
  le dernier état disponible : différentiel si sa base correspond, complet sinon.
- `resync` demande un état complet. Une mauvaise base ne modifie pas l'état
  affiché. Le retour d'un onglet déclenche une resynchronisation si nécessaire.
  Une décompression provenant d'un ancien socket est abandonnée.
- `resume {code,token}` rattache une connexion à sa place pendant 60 secondes
  après déconnexion. Le jeton aléatoire de 256 bits reste en mémoire. Le royaume
  reste humain pendant ce délai ; ensuite il devient bot. Les commandes en attente
  sont réémises avec leur numéro après reprise. Sans reprise, aucun passage en solo.
  Le jeton ne survit ni au rechargement de page ni au redémarrage du serveur.

Les actions de pause et de vitesse suivent les droits de l'hôte. Les autres
joueurs privés disposent de 15 secondes de pause toutes les cinq minutes.
Un hôte déconnecté cède sa place et libère la pause. Les parties publiques ne
se mettent pas en pause ; leurs cartes et bots suivent les réglages historiques.

## Bornes

Les limites du [transport commun](PROTOCOLE.md) s'appliquent aussi à la version 2.

| Variable | Défaut | Portée |
|---|---:|---|
| `MAX_ACTIVE_GAMES` | 2 | Refus avant création d'un enfant supplémentaire |
| `MAX_ROOMS` | 32 | Salons, parties et prochain salon public compris |
| `GAME_HEAP_MB` | 512 | Tas V8 de chaque enfant |
| `GAME_RSS_MB` | 768 | Arrêt si la RSS observée à une publication dépasse le plafond |
| `GAME_INIT_SECONDS` | 120 | Délai maximal avant le premier état |
| `RECONNECT_SECONDS` | 60 | Conservation de la place déconnectée |
| `AUTH_SPAWN_SECONDS` | 15 | Phase de placement initial |

Seize humains au maximum par partie. Vingt ordres par place par fenêtre de
100 ms ; files enfant de 320 ordres et 64 contrôles. Une saturation de file ou
du canal IPC arrête explicitement la partie. Aucun empilement illimité d'états
sur l'IPC : l'enfant attend l'acquittement du superviseur avant de publier.
Paquet décompressé limité à 64 Mio, en-tête à 8 Mio, transfert gzip à 16 Mio.
Sans acquittement de morceau pendant dix secondes, une connexion est fermée.
Une partie sans connexion ni jeton encore valable est arrêtée.

Le tas V8 n'est pas une limite de RSS. La surveillance RSS est périodique et
peut constater un dépassement après allocation. Le quota CPU, la limite mémoire
du superviseur et les limites système du groupe de processus restent à définir
pour un hébergement. Les processus et la VM ne sont pas un bac à sable système.

`GET /metrics` expose des compteurs agrégés sans jetons ni identifiants de salon :
initialisation, simulation, sérialisation/compression, octets binaires envoyés,
temps d'appel d'écriture, CPU, RSS et pic RSS Linux. `boucleMaxMs` est le plus
grand intervalle entre deux passages de la boucle enfant après initialisation ;
`retardMs` est sa dette de temps de simulation, incluant la fraction du tour courant.
Le temps d'émission mesure les appels d'écriture, pas le trajet réseau ni le décodage.

## Limites du prototype

- Les résultats et messages directement produits par un ordre, les demandes
  d'alliance et la fin de partie sont présentés. Les notifications et sons issus
  des événements automatiques de combat, de construction ou de mines ne sont
  pas encore tous répliqués. Les données de jeu correspondantes sont publiées.
- Les scénarios restent solo. Seuls Chromium et le loopback sont testés ici ;
  Firefox, Safari, mobile, latence, perte réseau et parties prolongées restent à tester.
- Les états complets sont recalculés à chaque publication, même sans nouvel
  arrivant : la sérialisation est encore coûteuse sur les grandes cartes.
- Pas de compte, de stockage de partie ni de reprise après redémarrage serveur.
  Pas de nouveau TLS, contrôle d'origine ou quota par adresse dans ce lot.
  Les jetons nécessitent un transport chiffré pour un hébergement distant.
- Aucun dimensionnement VPS, déploiement ou fusion. La [recette mesurée](../docs/validation-autoritaire.md)
  porte sur ce prototype, sans promesse de capacité en production.
