# Socle multijoueur — validation du 14 novembre 2026

Rapport historique du commit `f371225`. Le prototype livré ensuite et sa recette
sont décrits dans [validation-autoritaire.md](validation-autoritaire.md).

Base : `90c922df022206c362835019042f0046ac580373`. Aucun fichier de règles,
d'IA, de carte, de rendu ni de client réseau n'est modifié dans ce lot.
Le serveur est toujours un relais lockstep, sans reconnexion ni simulation autoritaire.

## Reproduire

Node 24.21.0, aucune dépendance à installer :

```sh
node --test tests/*.test.cjs
node outils/mesurer-moteur.cjs normal moyen 6000
node outils/mesurer-moteur.cjs normal grand 6000
node outils/mesurer-moteur.cjs europe grand 6000
```

Exécuter les trois mesures séparément, sans les lancer en parallèle. Chaque
commande crée un processus neuf. Le test réseau démarre un serveur temporaire
sur `127.0.0.1`, avec un port choisi par le système, et l'arrête ensuite.

## Ce qui est vérifié

Résultat final : **29 tests réussis**, aucun échec, sous Node 24.21.0.

- Parsing de vrais octets WebSocket : fragmentation avec ping intercalé, UTF-8,
  continuation invalide, binaire, bits réservés, longueurs excessives, premier
  message reçu avec l'upgrade. Les sockets des tests unitaires sont simulées.
- Bornes des fragments, tampons, rafales, messages incomplets et files de sortie ;
  bornes de connexions, salons, empreintes ; réglages invalides refusés.
- Validation de forme des ordres, maintien des montants fractionnaires et des
  sentinelles `-1`, exclusion des actions réservées et des scénarios solo.
- Un changement de salon refusé conserve le salon actuel ; rejoindre son propre
  salon ne le supprime plus du registre.
- Test réseau réel avec 17 clients Node : 16 dans un salon reçoivent exactement
  le même tour et le même ordre ; le second salon reste isolé ; un client ne
  choisit pas sa place dans son message ; un départ devient un seul ordre `leave`.
- Deux contextes du moteur : mêmes données complètes après 300 tours, bots,
  alliance, don d'or et départ d'un joueur ; cartes, royaumes et replays séparés.
- Deux points de vue, français/anglais : mêmes tableaux de carte et mêmes
  économies. Ce test ne compare pas toutes les données privées d'affichage.
- Le contrôle complet détecte une modification invisible pour `stateHash`.

Les 15 premiers cas de régression échouaient sur le relais initial. Ils sont
passés après correction. Les règles sont les scripts réels chargés dans leur
ordre HTML, pas une réimplémentation. Les sorties visuelles attendues sont
neutralisées explicitement ; un nouvel appel graphique non prévu fait échouer
le test. Le replay reste calculé.

## Mesures du moteur

Linux, Node 24.21.0, CPU présenté comme Intel Core Processor (Haswell, no TSX).
Graine 123456, 16 royaumes placés comme des humains puis remplacés par des bots
avec l'ordre normal `leave`, 6000 tours effectifs, 300 images de replay.
Chaque scénario est resté en phase `playing` jusqu'au terme demandé.

| Carte | Initialisation | Moyenne/tour | P99 | Maximum | Tours > 33,3 ms | Pic RSS |
|---|---:|---:|---:|---:|---:|---:|
| Normale moyenne | 3,40 s | 3,23 ms | 32,12 ms | 220,23 ms | 50 | 232,95 Mio |
| Normale grande | 7,59 s | 3,17 ms | 22,72 ms | 398,38 ms | 12 | 358,20 Mio |
| Europe | 67,38 s | 3,58 ms | 27,43 ms | 640,28 ms | 9 | 266,00 Mio |

Données complètes : [moyenne](mesures/2026-11-14-moyen.json),
[grande](mesures/2026-11-14-grand.json), [Europe](mesures/2026-11-14-europe.json).
Le pic RSS provient de `process.resourceUsage().maxRSS` sous Linux ; RSS et CPU
sont relevés avant le calcul final de l'empreinte complète.

Ces mesures incluent le moteur, les bots et le replay, mais excluent affichage,
sérialisation d'état, réseau et TLS. La machine peut être partagée ; il s'agit
d'une exécution par scénario, pas d'une distribution inter-exécutions. Le test
à 17 clients vérifie la cohérence du relais, pas sa capacité sous charge durable.

La génération Europe et les pointes de simulation rendent risqué un moteur
exécuté dans la boucle HTTP. L'isolation proposée répond à ce constat.
**Aucune capacité en nombre de parties sur 2 vCPU/4 Go ou 4 vCPU/8 Go n'est
validée**, et aucun gain de performance des règles n'est revendiqué.

## Limites de livraison

- Revue manuelle du diff et tests automatisés ; la revue indépendante demandée
  n'a pas pu s'exécuter, faute d'authentification disponible du relecteur.
- Pas de recette visuelle de navigateurs réels ni de test de suspension d'onglet.
  Les fichiers du solo restent inchangés, mais cela ne constitue pas une recette
  complète du jeu. Pas de comparaison inter-moteurs Chrome/Firefox/Safari.
- Le transport écrit à la main n'a pas subi une suite de conformité exhaustive
  RFC 6455. Les limites HTTP, TLS, origines et quotas par adresse restent hors lot.
- Le relais filtre les types ; les règles légales restent exécutées chez les
  clients. Les empreintes fournies par les clients ne sont pas une protection
  contre la triche. Aucun schéma d'état complet/différentiel n'est encore livré.
- Les plafonds de ressources et l'écoute locale sont des choix conservateurs
  examinables dans la PR ; ils ne sont pas des capacités d'hébergement mesurées.
- La [proposition autoritaire](multijoueur-autoritaire.md) attend validation avant
  sa mise en œuvre. Aucune fusion ni aucun déploiement.
