# Prototype autoritaire — validation du 14 novembre 2026

Architecture [approuvée](multijoueur-autoritaire.md), réalisée sur le socle
`f371225`, lui-même basé sur `90c922df022206c362835019042f0046ac580373`.
Le prototype reste volontairement activé par option ; aucun déploiement ni fusion.

## Vérifications

Node **24.21.0**, Chromium **156.0.8078.79**, Linux. Les tests chargent les règles
et les bots réels. Le protocole 1 garde ses tests de non-régression.

Résultat final : **40 tests réussis**, aucun échec ni test annulé (23,65 s).

- Codec : reconstruction complète/différentielle exacte, types, mauvaises bases,
  paquets tronqués, tableaux incomplets et séparation entre base réseau et affichage.
- Simulation : indices réels, alliance non sollicitée refusée, résultat d'ordre,
  répétition sans double paiement, commandes internes exclues.
- Serveur réel : reconnexion pendant génération et en jeu, expiration vers un bot,
  client sans acquittements fermé sans bloquer l'autre, transferts resynchronisés.
- Deux processus de partie : admission d'une troisième refusée ; arrêt forcé d'un
  enfant sans détruire le superviseur ni arrêter l'autre partie.
- Ancien socket : une décompression achevée après son remplacement ne s'installe pas.

La recette graphique ouvre **deux instances Chromium distinctes**, l'une en français,
l'autre en anglais. Elle crée/rejoint un salon, lance une alliance et l'accepte par
le bouton de l'autre joueur, donne de l'or et attaque un terrain neutre. Elle gèle
réellement le deuxième navigateur via CDP pendant que le serveur avance, le réveille,
coupe sa WebSocket et vérifie la reprise automatique. Elle altère aussi la séquence
de base pour vérifier le retour à un état récent.

Après mise en pause, les données structurées et **tous les octets des tableaux**
des deux clients donnent le même SHA-256 à la même séquence. Les compteurs de
`GameRules.init`, `update` et `runOrder` restent tous à zéro côté client.
Une partie solo ouverte via `file://` avance avec les règles locales. Aucune
exception `pageerror` pendant la recette ; l'erreur de base provoquée est attendue.

Captures : [salon vide](recette/salon-vide-fr.png), [salon rejoint](recette/salon-fr.png),
[partie FR](recette/partie-fr.png), [partie EN](recette/partie-en.png),
[connexion interrompue](recette/connexion-interrompue-en.png), [solo fichier](recette/solo-fichier.png).
Résultat détaillé : [recette navigateur](mesures/2026-11-14-navigateurs.json).

## Charge avec seize joueurs

Deux essais séparés sur carte normale, **16 clients WebSocket Node + 4 bots réels**,
vitesse ×3, environ 20 secondes mesurées après préparation. Un dix-septième joueur
est refusé. Les seize clients envoient chacun un don d'or par seconde : 304 ordres
sur chaque échantillon. Les seize états sont identiques en fin d'essai.

Machine partagée : CPU présenté comme Intel Haswell, 6 cœurs logiques, 11,4 Gio RAM.
Les deux relevés ci-dessous sont exécutés séparément, sans suite de tests simultanée.

| Mesure | Carte moyenne | Grande carte |
|---|---:|---:|
| Génération/initialisation | 3,70 s | 7,97 s |
| Tours/s, cible 30 | 29,95 | 30,02 |
| Publications/s, plafond 5 | 4,85 | 4,89 |
| Simulation sur l'échantillon | 1,32 s | 1,01 s |
| Sérialisation et gzip | 7,69 s | 11,61 s |
| CPU enfant | 16,87 s | 20,02 s |
| CPU superviseur | 0,91 s | 0,94 s |
| Appels d'émission binaire | 58,6 ms | 59,3 ms |
| Octets binaires émis, 16 clients | 9 285 152 | 9 954 752 |
| RSS enfant en fin d'échantillon | 170,2 Mio | 293,4 Mio |
| Pic RSS enfant depuis lancement | 170,2 Mio | 301,4 Mio |
| RSS superviseur en fin d'échantillon | 70,2 Mio | 79,3 Mio |
| Plus grand intervalle de boucle enfant | 216,5 ms | 293,3 ms |

Données brutes : [moyenne](mesures/2026-11-14-autoritaire-moyen.json),
[grande](mesures/2026-11-14-autoritaire-grand.json). Le CPU enfant couvre aussi
les allocations, le ramasse-miettes et l'IPC. Les octets comptent les charges binaires
compressées, sans en-têtes WebSocket/HTTP, TCP ou TLS. Le pic RSS et l'intervalle
maximal couvrent le processus depuis son démarrage, pas seulement les 20 secondes.

La sérialisation/compression coûte ici davantage que la simulation. La cadence
moyenne tient, avec des pointes de plusieurs centaines de millisecondes : aucune
promesse de latence constante. Le protocole partage les buffers compressés entre
clients et remplace les états obsolètes par le dernier état disponible.

**Aucune capacité VPS 2 vCPU/4 Go ou 4 vCPU/8 Go n'est validée.** Ces essais ne
reproduisent ni seize rendus graphiques, ni Internet, ni une partie prolongée.
Europe n'a pas été mesurée avec le nouveau transport ; son ancien benchmark
de moteur seul reste dans le [rapport historique](validation-multijoueur.md).

## Reproduire

```sh
node --test tests/*.test.cjs
node outils/mesurer-autoritaire.cjs
WORLD_SIZE=grand node outils/mesurer-autoritaire.cjs
PLAYWRIGHT_MODULE=/chemin/vers/playwright node outils/recette-navigateurs.cjs
```

Les outils lancent un serveur temporaire sur `127.0.0.1`, port libre, puis l'arrêtent
avec ses enfants. La recette nécessite Playwright et Chromium comme outils de test
externes au jeu ; `CHROMIUM` permet de choisir l'exécutable et `WORLD_ARTIFACTS`
le dossier de captures (défaut `/tmp/world-recette`). Le banc de charge accepte
`WORLD_MAP`, `WORLD_SIZE`, `WORLD_SECONDS`. Ne pas lancer les mesures en parallèle.

## Revue et limites

Revue manuelle du diff, tests et recette réelle. La tentative de revue indépendante
Claude du socle était bloquée par l'authentification ; la tentative Mistral du
prototype a expiré après quatre minutes sans résultat. Aucune approbation de
relecteur indépendant n'est revendiquée.

Les limites connues sont listées dans [AUTORITAIRE.md](../serveur/AUTORITAIRE.md#limites-du-prototype) :
notifications automatiques incomplètes, scénarios solo, coût des états complets,
absence de persistance, de recette inter-navigateurs et de quotas système.
