# États complets à la demande — 14 novembre 2026

Le prototype `c60eec2` préparait un complet gzip et un différentiel à chaque
publication, même si tous les clients disposaient de la base précédente.
Désormais, le processus prépare le complet initial puis uniquement ceux demandés
par le superviseur. Plusieurs clients sans base partagent une demande et un
buffer. Le protocole navigateur et le codec restent identiques.

Une reprise peut attendre la publication suivante, environ 200 ms en régime
normal. Les clients à jour continuent à recevoir les différentiels. Les demandes
répétées n'ajoutent pas de file : un booléen par partie les regroupe. En cas de
clients constamment en retard, le coût peut revenir à un complet par publication,
toujours au plafond de 5/s. Les limites de taille, d'IPC, d'acquittement et de RSS
sont conservées.

## Comparaison courte

Un passage avant, un passage après, exécutés séparément, sans test concurrent.
Même grande carte normale, graine **123456**, seize humains, quatre bots réels,
vitesse ×3. Fenêtre d'environ dix secondes après démarrage, avec une perte de
base provoquée à quatre secondes. Node 24.21.0 sur la même machine partagée.
Le processus de partie réel échange par IPC avec un décodeur de contrôle local.

| Mesure | Avant (`c60eec2`) | Après |
|---|---:|---:|
| Durée mesurée | 10,21 s | 10,00 s |
| Publications | 38 | 48 |
| Complets préparés dans cette fenêtre | 38 | 1 |
| Publication/s | 3,72 | 4,80 |
| Tours de simulation/s | 30,07 | 30,19 |
| Préparation/compression totale | 4,86 s | 4,89 s |
| Préparation/compression par publication | 127,9 ms | 101,8 ms |
| CPU enfant total | 9,32 s | 9,25 s |
| CPU enfant par publication | 245,4 ms | 192,8 ms |
| RSS enfant finale | 219,9 Mio | 197,6 Mio |
| Pic RSS enfant depuis démarrage | 219,9 Mio | 202,3 Mio |
| CPU décodeur de contrôle | 2,72 s | 0,99 s |

Le coût de préparation **par publication baisse de 20,4 %**, avec davantage
de publications dans la même durée. Le CPU enfant total reste pratiquement
inchangé ; ce relevé ne démontre pas une réduction du budget CPU par seconde.
Le pic RSS baisse d'environ 8 %. Aucun quota d'hébergement n'est déduit de cet
échantillon unique.

Le décodeur contrôle les octets et compare complet/différentiel lorsqu'un complet
est disponible : cette validation coûte davantage au banc initial, qui en reçoit
à chaque publication. La cadence inclut cet acquittement de contrôle ; elle ne
remplace pas une mesure de diffusion à seize navigateurs. Les essais réseau
précédents restent dans [validation-autoritaire.md](validation-autoritaire.md).

Données : [avant](mesures/2026-11-14-publication-avant.json),
[après](mesures/2026-11-14-publication-apres.json). Reproduction sur chaque révision :

```sh
node outils/mesurer-publication.cjs
```

Pour la révision antérieure, copier ce même outil dans son dossier `outils/`
avant l'exécution ; il n'était pas présent dans `c60eec2`.

Le compteur `complets` n'existait pas avant : le banc prend alors le nombre de
publications, puisque chacune produisait un complet. Le complet initial est
hors fenêtre ; après optimisation, deux complets sont préparés au total, celui
du départ et celui de la reprise provoquée. La capture, l'encodage différentiel
et gzip restent intégralement inclus dans `serialMs`.

## Validation limitée au changement

Huit cas ciblés passent : quatre du codec (exactitude et refus des bases/paquets
invalides), reprise avec déduplication des ordres, reprise pendant génération,
acquittement croisé, et nouvelle vérification du regroupement de deux reprises.
Cette dernière vérifie aussi qu'aucun complet supplémentaire n'est produit
lorsque les clients restent à jour. Le banc confirme une reprise exacte sur
grande carte. Aucune nouvelle recette graphique ni matrice de charge exécutée.

Les défauts connus du prototype ne sont pas aggravés : notifications automatiques
partielles et absence de reprise après redémarrage serveur. Aucun nouveau blocage
à un essai privé n'a été identifié dans les chemins vérifiés. Aucun déploiement.
