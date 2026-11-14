# 🌐 Medieval Emperor : le jeu en ligne

Ce dossier contient un **serveur de référence** (`serveur.js`) et la description de ce qu'il échange avec le jeu
(le « protocole »). Il sert à jouer à plusieurs, comme dans un jeu « .io » :

- 🌍 **la partie publique** : elle part **toutes les 2 minutes** avec tous ceux qui attendent, sur une carte tirée au
  hasard (aléatoire ou prédéfinie) ; des bots complètent la partie jusqu'à 10 royaumes. Personne ne peut la mettre en
  pause ni changer sa vitesse ;
- 🔒 **les salons privés** : un joueur crée un salon, il reçoit un **code** (et un lien à partager) ; les autres le
  rejoignent avec ce code. L'hôte choisit les réglages (carte, taille, pactes, difficulté, nombre de bots) et lance la
  partie. Il décide de la pause et de la vitesse ; chacun des autres peut mettre en pause **15 s, une fois toutes les
  5 minutes**.

Les scénarios (Factions, Charlemagne, guerre de Cent Ans) et les cartes dessinées restent en solo pour l'instant.

## Lancer le serveur

Il faut juste [Node.js LTS](https://nodejs.org/en/about/previous-releases) (22, 24 ou 26), sans rien installer d'autre.
Le banc de tests et les mesures de ce fork sont exécutés avec Node 24.21.0 :

```
node serveur/serveur.js
```

puis ouvrir **http://localhost:8080** : le serveur envoie aussi les fichiers du jeu. Les boutons
« 🌐 Jouer en ligne » apparaissent dans le menu.

- Un autre port : `PORT=3000 node serveur/serveur.js`
- Le serveur écoute uniquement sur `127.0.0.1` par défaut. Pour une autre interface, définir explicitement `HOST`.
  `PORT=0` demande un port libre au système (affiché au démarrage), notamment pour les tests.
- Une partie publique plus souvent (pour essayer) : `PUBLIC_SECONDS=20 node serveur/serveur.js`
- Les autres règles (nombre de royaumes de la partie publique, temps pour choisir sa place, durée des pauses…) sont en
  haut de `serveur.js`.

### Ressources du relais

| Variable | Défaut | Rôle |
|---|---:|---|
| `MAX_CONNECTIONS` | 128 | Connexions WebSocket simultanées ; les suivantes reçoivent HTTP 503 |
| `MAX_ROOMS` | 32 | Salons et parties en cours, prochain salon public compris ; minimum 2 |
| `MAX_MESSAGE_BYTES` | 16384 | Octets cumulés d'un message, fragments compris |
| `MAX_PENDING_BYTES` | 262144 | Octets de sortie en attente par connexion, nouvelle trame comprise |

Une limite invalide fait échouer le démarrage. Un client trop lent est déconnecté ; les autres continuent.
Au plus 128 fragments par message, 256 trames par seconde et par connexion, et 20 ordres par joueur et par tour.
Un message incomplet expire après 30 à 60 secondes (contrôle toutes les 30 secondes).
La réception tamponne au plus `MAX_MESSAGE_BYTES + 65536` octets avant de refuser la connexion.
Le plafond de 16 humains par partie est conservé. À capacité maximale, une création de salon reçoit `full` et
le départ public est reporté d'un cycle, pour conserver la place du prochain salon public.

Ce sont des bornes applicatives, pas une protection complète d'un service public : la terminaison TLS,
les limites HTTP et par adresse et les contrôles d'origine restent à traiter avant une exposition publique.
Le protocole accepte du texte UTF-8 et des trames de contrôle ; le binaire et les extensions sont refusés.
Référence de la fragmentation : [RFC 6455, sections 5.2 à 5.5](https://www.rfc-editor.org/rfc/rfc6455).

**Jouer depuis GitHub Pages** avec un serveur ailleurs : mettre son adresse dans `CONFIG.NET.SERVER`
(`js/config.js`), par exemple `'wss://mon-serveur.fr/ws'`, ou pour essayer sans toucher au code :
`https://dr-brioche.github.io/World/?serveur=wss://mon-serveur.fr/ws`. Une page en `https` exige un serveur en
`wss://` (WebSocket chiffré : derrière un « reverse proxy » comme nginx ou Caddy, qui s'occupe du certificat).

## Comment ça marche : le « lockstep » (comme OpenFront)

Le serveur **ne calcule pas** la partie. Chaque navigateur la calcule de son côté :

1. au départ, le serveur donne à tous **la même graine** (le hasard de la partie) et les mêmes réglages : tout le
   monde génère la même carte et place les bots aux mêmes endroits ;
2. chaque action d'un joueur (attaquer, construire, améliorer…) est un **ordre**, envoyé au serveur ;
3. 10 fois par seconde (à vitesse x1 ; 30 fois à x3), le serveur envoie à tous un **tour** : la liste des ordres reçus
   depuis le tour d'avant ;
4. chaque navigateur exécute les ordres du tour (`Game.runOrder`), puis fait avancer la partie d'un tour
   (`Game.update`).

Comme tout le monde part du même état et applique les mêmes ordres dans le même ordre, toutes les parties restent
**identiques**. Pour ça, la partie doit être **déterministe** : le hasard vient de `Game.rand()` (jamais
`Math.random()`), et les calculs de sinus, d'arc tangente… passent par `DMath` (`js/dmath.js`), qui donne le même
résultat dans tous les navigateurs.

Pour vérifier, chaque navigateur envoie de temps en temps l'**empreinte** de sa partie (`Game.stateHash()`) ; si deux
empreintes diffèrent, le serveur prévient tout le monde (c'est un bug à corriger).

## Les messages

Des messages **JSON** sur une WebSocket, à l'adresse `/ws`. Chacun a un champ `t` (son type).

### Du navigateur au serveur

| Message | Quand | Ce qu'il fait |
|---|---|---|
| `{ t: 'hello', protocol, name, banner }` | à la connexion | se présenter : version du protocole (`CONFIG.NET.PROTOCOL`), nom du royaume, numéro de bannière (`BANNERS`) |
| `{ t: 'public' }` | menu | rejoindre la prochaine partie publique |
| `{ t: 'create', settings }` | menu | créer un salon privé (on en devient l'hôte) |
| `{ t: 'join', code }` | menu | rejoindre un salon privé avec son code |
| `{ t: 'leave' }` | salon | quitter le salon |
| `{ t: 'profile', name, banner }` | salon | changer de nom ou de bannière |
| `{ t: 'settings', settings }` | salon, hôte | changer les réglages : `{ mapType, mapSize, pacts, difficulty, opponents, spawnMode }` (`spawnMode` : `'libre'`, `'aleatoire'` ou `'places'`, les places prévues d'une carte arène) |
| `{ t: 'start' }` | salon, hôte | lancer la partie |
| `{ t: 'order', s, o }` | partie | un ordre `o` (voir plus bas), avec son numéro `s` (pour retrouver son résultat) |
| `{ t: 'pause', on }` | partie | demander la pause (`on: true`) ou la reprise |
| `{ t: 'speed', v }` | partie, hôte | changer la vitesse (1, 1.5, 2 ou 3) |
| `{ t: 'hash', n, h }` | partie | l'empreinte de la partie au tour `n` (tous les `CONFIG.NET.HASH_EVERY` tours) |

### Du serveur au navigateur

| Message | Ce qu'il dit |
|---|---|
| `{ t: 'room', code, public, host, you, players, settings, startsIn, rules }` | l'état du salon (à chaque changement) : `players` = `[{ id, name, banner }]`, `host` = id de l'hôte (`null` : partie publique), `you` = notre id, `startsIn` = ms avant le départ de la partie publique |
| `{ t: 'start', seed, settings, players, me, host, public, spawnTurns, rules }` | la partie commence : `players` = `[{ name, banner }]` dans le même ordre pour tous ; `me` = notre place dans cette liste ; `host` = la place de l'hôte (-1 : partie publique) |
| `{ t: 'turn', n, o }` | le tour `n` et ses ordres : `o` = `[[place du joueur, ordre, numéro], …]` |
| `{ t: 'pause', on, by, limit }` | la partie est en pause (ou reprend) ; `by` = qui l'a demandée ; `limit` = durée maximale (ms) |
| `{ t: 'speed', v }` | la nouvelle vitesse |
| `{ t: 'host', slot }` | l'hôte est parti : `slot` le remplace |
| `{ t: 'desync', n }` | les empreintes diffèrent au tour `n` |
| `{ t: 'error', code }` | `protocol`, `noroom`, `started`, `full`, `host`, `pause` (avec `wait`, en ms), `nopause` |

### Les ordres

Un ordre est un objet `{ k: 'sorte', … }` ; la liste complète est dans `Game.runOrder` (`js/game.js`). Par exemple :
`{ k: 'attack', target, troops, aim, src }`, `{ k: 'build', i, type }`, `{ k: 'upgrade', a }`,
`{ k: 'defend', attack, troops }`, `{ k: 'ally', to }`, `{ k: 'allyAnswer', from, yes }`, `{ k: 'spawn', i }`…

Le relais filtre désormais leur **forme** (`validOrder`) : sorte connue pour le multijoueur, indices entiers,
montants numériques finis positifs ou nuls, réponses booléennes. Les ordres solo sont exclus. Le numéro `s`
est un entier de 0 à 2147483647. Les actions mal formées sont ignorées ; les règles du navigateur vérifient
toujours les ressources, l'appartenance des cases et les cibles. Ce contrôle n'en fait pas un serveur autoritaire.
Les empreintes doivent concerner les 2000 derniers tours déjà émis et être des entiers non signés de 32 bits.

Les tests et les mesures se trouvent dans [`docs/validation-multijoueur.md`](../docs/validation-multijoueur.md).
Le protocole autoritaire expérimental 2 est activé séparément avec `AUTHORITATIVE=1`
et `?autoritaire=1` dans le navigateur. Voir [AUTORITAIRE.md](AUTORITAIRE.md).
La présente page décrit le relais historique, toujours sélectionné par défaut.

Deux ordres ne viennent que du **serveur** (il les refuse s'ils viennent d'un navigateur) :

- `{ k: 'begin' }` : au tour `spawnTurns` (15 s après le départ), le choix des places est fini, la partie commence ;
  ceux qui n'ont pas choisi sont placés au hasard (le hasard de la partie : la même place chez tout le monde) ;
- `{ k: 'leave' }` : un joueur est parti (ou a perdu sa connexion) ; un bot prend sa place.

### Déroulement d'une partie

```
navigateur                         serveur
   hello ───────────────────────────▶
   create / join / public ──────────▶
   ◀─────────────────────────────── room (à chaque changement)
   start (hôte) ────────────────────▶
   ◀─────────────────────────────── start (graine, réglages, joueurs)
   order {k:'spawn', i} ────────────▶          (choix de sa place, pendant 15 s)
   ◀─────────────────────────────── turn 1, 2, 3… (10 par seconde × la vitesse)
   ◀─────────────────────────────── turn 150 : [[0, {k:'begin'}]]
   order {k:'attack', …} ───────────▶
   ◀─────────────────────────────── turn 153 : [[2, {k:'attack', …}, 7]]
   hash {n: 200, h} ────────────────▶
```

## Adapter un autre serveur

Le serveur de référence est volontairement simple (un seul fichier). Pour en écrire un autre (dans un autre langage,
ou dans un serveur existant), il suffit de respecter les messages ci-dessus. Les points importants :

- les **tours** doivent arriver à tous dans le même ordre, numérotés à partir de 1, sans trou ;
- les ordres d'un tour sont exécutés dans l'ordre de la liste : c'est le serveur qui fixe cet ordre ;
- le choix des places dure `spawnTurns` tours, à vitesse x1, et se termine par l'ordre `begin` ;
- la pause = le serveur n'envoie plus de tours ; la vitesse = il les envoie plus ou moins vite.
