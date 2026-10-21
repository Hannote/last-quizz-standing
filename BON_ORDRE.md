# Le Bon Ordre — version à cartes

L'identifiant `le_bon_ordre` reste partagé par les modes Battle Royale et Liste.
Le fichier de données et les images de production n'ont pas été modifiés.

## Fichiers

- `le-bon-ordre.js` : validation, tirages, mémoire atomique, barème et classement avec égalités.
- `server.js` : lancement, instantanés, réponses, correction automatique, reconnexion et administration.
- `public_2/client.js`, `public_2/index.html` : cartes, sélecteur de rang, brouillons personnels et correction.
- `test/le-bon-ordre.test.js`, `test/bon-ordre-server.test.js`, `test/bon-ordre-safety.test.js` : tests ciblés.
- `test/helpers/bon-ordre-memory.cjs` : stockage isolé pour les tests serveur.
- Les tests existants `admin-memory`, `liste-flow`, `question-shuffle`, `liste-drawing` et `leaderboard-callback` sont adaptés au nouveau contrat ou aux nouveaux états client.
- `tests/bon-ordre-live.cjs`, `tests/bon-ordre-visual.cjs` : parcours Socket.IO réels et contrôles du navigateur.
- `.gitignore` : exclusion des profils, captures et mémoires générés dans `.test-run/`.

## Comportement

Les sept thèmes sont mélangés ; cinq éléments de chaque pool sont sélectionnés
et leur disposition reste fixe pour tous les joueurs. Un instantané serveur
conserve les valeurs. Avant correction, seuls les noms, images et identifiants
sélectionnés sont transmis. Le JSON complet est bloqué par le serveur HTTP.

Les réponses utilisent les identifiants ordonnés, liés à l'instance et à la
question. Les propositions non validées ne sont jamais envoyées à expiration.
Chaque question suit désormais le même parcours :

1. Annonce du thème, puis question et chronomètre de 45 secondes ; le délai
   existant de 2,5 secondes entre l'annonce et le début du temps est conservé.
2. Clôture serveur à l'échéance ou quand tous les participants éligibles ont
   répondu ou passé. Les points et le temps de cette seule question sont
   calculés et appliqués une fois.
3. Correction personnelle, en lecture seule, pendant **15 000 ms** pour le salon.
4. Animation du classement existant, pendant 3 secondes entre deux questions
   ou 4,5 secondes après la septième (durées effectives du Faux du Vrai).
5. Thème suivant pour les questions 1 à 6 ; animation de fin existante après la
   question 7, puis suite normale du mode Liste ou Battle Royale.

Il n'existe plus de correction collective finale pour ce mini-jeu, ni de
navigation entre les joueurs ou les questions, ni de bouton de notation ou
de passage anticipé. Les fonctions communes restent utilisées par les autres
mini-jeux. Les classements intermédiaires ne distribuent pas les points de
placement Liste et ne déclenchent pas d'élimination Battle Royale.

Le barème est centralisé dans `bonOrdreGrade` et les temps reprennent
`calculateGradeRevision` : temps réel pour 1 ou 0,5 point, 45 secondes pour zéro.

## Correction personnelle et synchronisation

Le serveur conserve les sous-phases `theme`, `answering`, `correction`,
`leaderboard` et `ending`, ainsi que l'instance et l'index de question.
La phase globale reste compatible avec le déroulement existant du jeu.
Les callbacks différés vérifient salle, partie, mode, manche, question et
sous-phase. Aucun accusé de réception d'un navigateur n'est nécessaire pour
continuer le salon.

`leBonOrdreCorrection` est envoyé séparément à chaque socket authentifié.
Il contient uniquement le bon classement de la question terminée et la propre
proposition de ce participant, sa note et ses positions. L'hôte ne reçoit
aucune proposition d'un autre joueur. Un spectateur reçoit le bon classement
et ses valeurs, sans proposition ni score personnel. Un participant
temporairement déconnecté conserve son résultat ; son statut repose sur la
participation à la question et non sur la présence de sa connexion.

Le serveur enregistre le début et l'échéance de correction. Le compteur client
affiche le temps restant reçu, mais ne fait jamais avancer la partie. Une
reconnexion pendant les 15 secondes restaure la même correction personnelle
et l'échéance initiale. Pendant le classement ou la fin, elle restaure cette
phase au lieu de rouvrir une ancienne correction.

`leBonOrdreLeaderboard` réutilise `handleInterimLeaderboard`, avec les snapshots
avant et après la question, ses dates et sa durée restante. Le serveur lance
le thème suivant après sa fin, sans dépendre d'un client connecté. Le résultat
de tournoi ou l'élimination ne sont calculés qu'à la fin unique du mini-jeu.

## Mémoire et Railway

La mémoire globale, partagée entre salons comme l'ancien historique, se trouve
dans `data/le_bon_ordre_elements_v1.json` en local. Si `/data` existe, le serveur
utilise `/data/le_bon_ordre_elements_v1.json`. La variable
`LQS_BON_ORDRE_MEMORY_FILE` permet de choisir un autre chemin.

Le format versionné `{ "version": 1, "pools": { "population": ["id"] } }`
est indépendant de l'ancien historique des questions et des autres mini-jeux.
Les sept sélections sont consommées au lancement effectif, en un seul commit
par fichier temporaire, synchronisation et renommage atomique. Un verrou
exclusif protège les accès concurrents. Une erreur de stockage bloque le
lancement avec un message explicite ; une partie abandonnée reste consommée.

L'administration existante expose cette mémoire sous `le_bon_ordre_elements_v1`.
Les commandes de remise à zéro du Bon Ordre ciblent cette mémoire, sans utiliser
les anciens identifiants de questions. Après un arrêt brutal pendant une
écriture, un fichier `.lock` peut rester : vérifier qu'aucun processus ne
l'utilise avant de le retirer. Aucun historique n'est effacé automatiquement.

Sur Railway, un volume persistant doit couvrir le chemin réellement utilisé,
par exemple un volume monté à `/data` avec la configuration actuelle. Les
fichiers hors volume ne persistent pas entre déploiements, selon la
[documentation Railway](https://docs.railway.com/volumes). Aucun fichier de
configuration du dépôt ne permet de confirmer le montage du service réel.
Les salons actifs restent en mémoire, comme avant : un redémarrage ne restaure
pas une partie en cours, mais conserve les éléments consommés sur le volume.

## Vérifications réalisées

```powershell
npm ci
node --check server.js
node --check le-bon-ordre.js
node --check public_2/client.js
node --test --test-isolation=none test/le-bon-ordre.test.js test/bon-ordre-server.test.js test/bon-ordre-safety.test.js
node --test --test-isolation=none test/*.test.js tests/*.test.cjs
```

Les 47 tests Bon Ordre passent : contrat du formulaire réel avec le middleware,
cycles exacts et incomplets, indépendance,
persistance sur disque, doubles appels, concurrence, échecs d'écriture,
égalités, notes et temps, refus des réponses périmées, confidentialité,
abandons, spectateurs et reconnexion.
Les tests sous horloge contrôlée vérifient les sept corrections personnelles,
la frontière 14 999 / 15 000 ms, les classements 3 / 4,5 secondes, la reprise
du thème, la fin unique, les callbacks retardés ou obsolètes et l'absence de
réouverture de la correction collective dans les deux modes.

La suite complète comporte 212 tests : 188 réussis, 24 échecs déjà présents
avant les modifications. Aucun nouveau scénario en échec par rapport au relevé
initial. Les échecs restants concernent des doubles client incomplets,
les anciens scénarios Pénave et les données simulées de classement.
Le script `npm test` du dépôt reste un simple message « no test specified ».
`--test-isolation=none` évite la création de processus interdite dans cet
environnement ; les tests utilisent des stockages isolés.

Le serveur est vérifié avec `npm start` sur le port 3000 et des chemins de
mémoire de test. Les parcours complets de deux salons simultanés (Liste et
Battle Royale), avec trois joueurs et un spectateur, ont été validés lors de
l'ajout des corrections personnelles. Avec le délai de 15 secondes, les
47 tests ciblés et le premier enchaînement réel dans le navigateur sont
réexécutés. Le script `tests/bon-ordre-live.cjs` est adapté au délai de 15 secondes
pour les parcours complets. Les reconnexions pendant la réponse, la correction
et le classement conservent le bon état.
Les requêtes au JSON confidentiel ont renvoyé 404.
Le démarrage d'un autre mini-jeu Battle Royale avec trois clients a aussi été
contrôlé (`tests/penave-br-regression.cjs`).

Les tests navigateur couvrent les deux modes à 320, 375, 430 et 1024 pixels,
avec cartes textuelles et illustrées, noms longs, sélecteur aux bords, clavier,
annulation, validation, passage, absence de réponse automatique, brouillon,
reconnexion et correction. Aucun débordement horizontal ni exception
JavaScript. Les assets du jeu se chargent ; seule la requête au
`favicon.ico` absent renvoie 404. Les captures sont dans `.test-run/captures/`.
Un parcours réel dans le navigateur valide également une partie Liste avec
Alice, Bob, un troisième participant et un spectateur. Alice et Bob reçoivent
leurs propositions distinctes ; le spectateur n'obtient que le bon classement.
L'actualisation pendant la correction restaure la proposition personnelle et
la même échéance. Après 15 secondes, le classement apparaît pendant 3 secondes,
une actualisation le restaure, puis le thème et les cartes vierges de la
question 2 apparaissent. Les captures correspondantes portent les noms
`bon-ordre-live-alice-correction-375.png`,
`bon-ordre-live-alice-correction-reconnected-375.png`,
`bon-ordre-live-ranking-after-correction-375.png` et
`bon-ordre-live-question-two-375.png`.
La fin historique du Petit Bac, qui utilise le même événement de sortie,
et le rejet d'une ancienne sortie Bon Ordre dans un autre jeu sont aussi
vérifiés dans le navigateur.

## Données réelles vérifiées

Le JSON présent est déjà restructuré et valide : sept pools de cinq éléments.
Chaque pool minimal réutilise donc ses cinq éléments au cycle suivant.
Tous les chemins d'images actuellement référencés correspondent à des fichiers
présents. Cette vérification est faite en lecture seule. Les noms restent
visibles lorsqu'une image ne charge pas.

Aucune donnée, image ou dépendance de production n'a été ajoutée ou remplacée.
Aucun déploiement ni push Git n'a été effectué.
