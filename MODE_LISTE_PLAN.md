# Mode Liste — plan validé et règles de reprise

- État actuel : étapes 1 à 6 terminées ; étape 7 — contrôles techniques terminés, validation manuelle finale en attente (28 septembre 2026).
- Commits : étape 1 — `286eb9f` ; étape 2 — `1513a7b`.
- Validation de l’étape 4 : tests automatisés réussis ; tests manuels des jeux avec correction, du Petit Bac et des QCM réalisés avec succès, chronos compris.
- Validation de l’étape 5 : tests manuels réalisés et réussis avec quatre joueurs, comprenant un Battle Royale complet et un tournoi Liste complet des sept mini-jeux compatibles.
- Validation de l’étape 6 : enregistrée dans le commit `e5ce2d4` et validée manuellement par l’utilisateur.
- Correction des égalités de mini-jeux Liste : réalisée, non commitée. Le serveur transmet l’ordre et les places, le client les conserve ; joueurs retirés exclus, points de tournoi inchangés lors des affichages intermédiaires. 55 tests réussis après correction, syntaxe et `git diff --check` conformes. Les contrôles manuels spécifiques de cette correction restent en attente de confirmation de l’utilisateur.
- Validations réseau antérieures réutilisées pour le serveur et les chemins HTTP inchangés : smoke Socket.IO réel (lancement Liste jusqu’aux règles, abandon, nouvelle partie Battle Royale), quatre endpoints HTTP en 200, hash de l’historique des questions inchangé. Aucun serveur relancé pendant cette correction client. L’échec historique de `npm test` reste celui de son placeholder ; exécution des tests avec `node --test --test-isolation=none`.
- Contrôles complémentaires de l’étape 7 : les 13 tests de la reprise passent désormais, y compris la reproduction du callback obsolète initialement en échec. Reconnexions en question dans les sept jeux avec réponse et temps conservés ; reconnexion pendant correction et transfert d’hôte ; reconnexion/abandon à mi-classement sans décaler les 8 secondes ; reconnexion tardive au tirage sans décaler son échéance serveur ; classement final permanent, vainqueur unique/co-vainqueurs et absence de participant admissible ; parcours Battle Royale avec vrais handlers et horloge simulée, de la correction du Petit Bac à l’élimination puis la victoire aux Enchères, délais historiques compris. La persistance de ces essais est remplacée en mémoire.
- Callback obsolète corrigé sur autorisation : `fauxVraiReveal` pouvait réactiver `leaderboard-overlay` après « Quitter » ; le chemin Leugtas et les anciennes fermetures/nettoyages présentaient le même risque après remplacement du contexte. `public_2/client.js` invalide désormais ces rappels lors du départ, de la rejointure, du changement de partie/manche/contexte d’affichage et des nouvelles questions concernées. Avant leurs effets, les rappels vérifient l’identité d’affichage, la salle, le mode, le tournoi, la manche, le mini-jeu et la question Liste. La transition normale vers `listeRoundEnd` est acceptée ; les délais, sons, animations, places serveur et le rafraîchissement sans prolongation après abandon sont conservés. Aucun changement serveur ou réseau supplémentaire.
- Résultat après correction : 89 tests distincts réussis, 0 échoué sur le code actuel (68 tests existants et 21 tests de `test/leaderboard-callback.test.js`). Avant correction, la première série ciblée reproduisait 12 échecs sur 17 cas ; elle passe après correction, puis a été complétée. Syntaxe conforme des trois fichiers principaux et des huit fichiers de tests ; `git diff --check` conforme. Les essais client utilisent les vrais handlers avec DOM/sons/horloge simulés ; aucune validation visuelle n’est revendiquée.
- État exact de l’étape 7 : contrôles techniques terminés, validation manuelle finale en attente. Aucun blocage technique identifié dans la campagne prévue après cette correction. Aucun navigateur exposé par l’environnement lors de la reprise ; les résultats réseau réels antérieurs ne valident pas visuellement les nouveaux contrôles client.
- Contrôles manuels encore en attente : classements intermédiaires/finals des jeux QCM et à correction manuelle avec égalités `1, 1, 3` et `1, 2, 2, 4` ; abandon pendant un classement et reconnexions en question/correction/classement/tirage ; quitter avant les 2,5 secondes Faux du vrai/Leugtas puis rejoindre Liste ou Battle Royale, sans ancien classement ni fermeture d’un nouveau classement ; portrait 320/375/430 px avec pseudonymes longs, nombreux joueurs, défilement et bouton Quitter ; transitions, sons et animations Liste/Battle Royale avec finale Enchères et victoire. Ne les marquer réussis qu’après confirmation de l’utilisateur.
- Prochaine action : recueillir les confirmations manuelles finales de l’utilisateur avant de clôturer l’étape 7. L’étape 7 n’est pas encore validée globalement.
- Aucun commit, push ou tag sans autorisation.

Cet état de reprise décrit les validations réellement acquises et les contrôles encore en attente. La consigne actuelle « Aucun commit, push ou tag sans autorisation » prévaut sur l’autorisation générale de commits mentionnée dans les échanges antérieurs recopiés ci-dessous. Les points Git du plan sont des propositions, pas des commandes à exécuter automatiquement.

## Plan validé en sept étapes — copie intégrale

Je propose **sept étapes**, chacune validée avant la suivante. Aucune modification ni commande Git ne sera exécutée à ce stade.

Les règles retenues sont : `N` fixé au lancement, points calculés par `N - place + 1`, classement avec places sautées en cas d’égalité, abandons définitifs et reconnexion réservée aux participants inscrits. Une reconnexion conservera aussi l’état `withdrawn` : elle ne permettra pas de revenir dans le tournoi après abandon.

### 1. Introduire le mode dans les salles et le lobby

- **`server.js`** : ajouter `gameMode`, avec `battle_royale` par défaut ; autoriser uniquement l’hôte à le modifier avant le lancement ; le transmettre dans `serializeRoom` et `getGameStateSummary`.
- **`public_2/index.html`** : ajouter le choix Battle Royale / Liste.
- **`public_2/client.js`** : synchroniser ce choix et appliquer une classe spécifique au mode Liste.

**Validation :** plusieurs clients voient le même mode ; un invité ne peut pas le changer ; une reconnexion restaure le choix ; le Battle Royale démarre comme auparavant. Le lancement Liste restera indisponible jusqu’à l’intégration de son déroulement.

**Point Git proposé :** `feat: ajouter le choix du mode dans le lobby`

### 2. Configurer la sélection des mini-jeux

- **`server.js`** : définir un catalogue indiquant les modes compatibles ; calculer le maximum Liste depuis ce catalogue ; valider le nombre demandé et la sélection manuelle.
- **`public_2/index.html`** : ajouter les réglages Liste : nombre, sélection aléatoire ou manuelle.
- **`public_2/client.js`** : afficher les jeux compatibles et synchroniser la configuration.

Au lancement, le serveur préparera une liste sans doublon, mélangée dans les deux méthodes de sélection. Les Enchères seront exclues.

**Validation :** configurations limites, doublons, identifiants inconnus, Enchères et modification par un invité ; affichage entre 320 et 430 pixels.

**Point Git proposé :** `feat: configurer les mini-jeux du mode Liste`

### 3. Fixer les participants et gérer les abandons

- **`server.js`** : enregistrer les participants initiaux et `initialParticipantCount` ; ajouter `withdrawn` ; refuser toute nouvelle identité après le lancement.
- Adapter `joinRoom`, `leaveRoom`, `disconnect`, les joueurs prêts et les listes de correction.
- **`public_2/client.js`** : afficher les refus d’entrée et les départs sans animation d’élimination.

Une déconnexion technique conservera la possibilité de reconnexion. Un abandon explicite retirera le joueur des classements, y compris celui du mini-jeu courant, sans modifier `N`.

**Validation :** nouvelle arrivée refusée, reconnexion acceptée, abandon pendant les règles, les questions ou la correction, départ de l’hôte et maintien d’un hôte capable de poursuivre.

**Point Git proposé :** `feat: gérer les participants et abandons en mode Liste`

### 4. Fiabiliser les résultats et calculer les classements

- **`server.js`** : historiser les temps par question pour les jeux à correction manuelle ; vérifier les valeurs de notation.
- Ajouter des fonctions dédiées au classement Liste et les champs `tournamentPoints`, `tournamentTime`, `tournamentPlacements`.
- Figer chaque résultat avant la remise à zéro des statistiques du mini-jeu.
- Garantir une attribution unique des points par manche.

Les corrections nécessaires aux temps seront isolées et vérifiées séparément pour mesurer leur effet sur le Battle Royale.

**Validation automatisée :** score puis temps, égalités parfaites, places sautées, `N` fixe après abandon, exclusion des joueurs retirés, correction révisée et double demande de finalisation. Tests avec les outils déjà disponibles, sans nouvelle dépendance.

**Point Git proposé :** `feat: calculer les classements du tournoi Liste`

### 5. Intégrer le déroulement du tournoi

- **`server.js`** : séparer explicitement les branches Battle Royale et Liste dans le démarrage et `endMiniGame`.
- Liste suivra la séquence préparée, sans élimination ni finale Enchères.
- Protéger les callbacks par l’identité de la partie, le mode, la manche et la phase ; annuler les minuteries devenues inutiles.
- Adapter les différentes fins de mini-jeux à ce chemin commun.

**Validation :** tournoi complet, aucune répétition, événements retardés ou répétés, abandon pendant une transition ; contrôle des sept mini-jeux et nouvelle partie Battle Royale.

**Point Git proposé :** `feat: intégrer le déroulement du tournoi Liste`

### 6. Afficher les classements et les vainqueurs

- **`public_2/client.js`** : utiliser les classements calculés par le serveur ; afficher le classement général après chaque mini-jeu ; gérer plusieurs vainqueurs ex æquo.
- Supprimer l’écran vide observé entre la fin des animations d’un mini-jeu Liste et le tirage suivant ; afficher pendant cette transition le classement général calculé par le serveur et ajuster la durée des attentes sans couper les animations existantes.
- Conditionner au mode Liste toute modification des écrans ou des délais de transition ; conserver à l’identique les animations et leur durée en Battle Royale.
- Prévoir une introduction et une annonce des vainqueurs propres au mode Liste, dans la direction artistique et sonore du jeu.
- Conditionner introduction, élimination, tête de mort et annonce des finalistes au Battle Royale.
- **`public_2/index.html`** : ajouter les composants Liste avec styles isolés, pseudonymes longs, défilement interne et bouton Quitter accessible ; vérifier leur rendu mobile.

**Validation :** portrait de 320 à 430 pixels, nombreux joueurs, égalités, reconnexion sur un classement et victoire partagée.

**Point Git proposé :** `feat: afficher les classements et vainqueurs du mode Liste`

### 7. Valider l’ensemble avant livraison

Effectuer une campagne multiclient Liste et Battle Royale : sélection, sept mini-jeux, corrections, abandons, reconnexions, transitions et victoire.

À chaque étape : contrôle de syntaxe, tests pertinents, erreurs serveur et navigateur, puis revue du diff avant le commit. Pour les essais, vérifier le serveur existant ; si un lancement est nécessaire, respecter `npm ci` puis `npm start`, sans deuxième serveur.

**Dernier point Git proposé :** commit des éventuels correctifs, puis repère de version validée. Aucun push sans demande explicite.

Les fichiers de persistance et les assets existants resteront hors du périmètre des modifications prévues.

## Précisions validées avant le plan

### 1. Valeur de N après un abandon

- `N` correspond au nombre de participants présents au lancement du tournoi et reste fixe pendant tout le tournoi.
- Un joueur qui abandonne passe dans un état séparé `withdrawn`.
- Il disparaît définitivement du classement général et des classements des mini-jeux suivants.
- S’il abandonne pendant un mini-jeu, il est également retiré du classement de ce mini-jeu et les joueurs restants remontent dans le classement.
- Les points restent calculés avec le `N` initial afin que tous les mini-jeux aient le même poids.

### 2. Égalités parfaites

- Le classement d’un mini-jeu est d’abord déterminé par le score, puis par le temps.
- Si deux joueurs ont exactement le même score et le même temps, ils occupent la même place et reçoivent le même nombre de points.
- La place suivante est sautée : par exemple, deux premiers reçoivent chacun `N` points et le joueur suivant est troisième avec `N - 2` points.
- Pour le classement général final, on départage d’abord par le total de points, puis par le temps cumulé.
- Si les deux valeurs sont encore identiques, les joueurs sont déclarés ex æquo. Aucun départage aléatoire.

### 3. Arrivées pendant un tournoi

- Aucun nouveau joueur ne peut devenir participant après le lancement du tournoi.
- Une personne n'étant pas joueur et n'étant pas là au début du lancement du jeu ne peut pas rejoindre de salle en cours.
- Une reconnexion d’un joueur déjà inscrit n’est pas considérée comme une nouvelle arrivée : il doit retrouver sa place et son état grâce à son identité de reconnexion comme sur le mode battle royale actuel.

## Précisions ajoutées après le plan

- En V1, une nouvelle personne arrivant pendant un tournoi Liste est refusée. Le mode spectateur reste hors périmètre.
- Une reconnexion doit être reconnue par l’identifiant technique existant du joueur, pas uniquement par son pseudonyme.
- En sélection manuelle, l’hôte choisit uniquement les mini-jeux, jamais leur ordre. Le serveur mélange systématiquement la sélection.
- Une fermeture de page ou une perte de connexion reste une déconnexion temporaire. Seule l’action explicite « Quitter » déclenche `withdrawn`.
- Les nouvelles structures de temps et de classement doivent éviter autant que possible de modifier les données utilisées par le Battle Royale.
- Les fonctions de classement devront être isolées afin de pouvoir être testées avec le module natif `node:test`, sans ajouter de dépendance.
- Les commits peuvent être réalisés après validation de chaque étape, mais aucun push vers GitHub sans mon accord explicite.

La dernière puce ci-dessus reproduit l’autorisation antérieure. Elle est désormais soumise à la consigne de reprise en tête de ce document : **aucun commit ni push sans autorisation**.

### Interprétations confirmées dans la session

- L’identifiant technique de reconnexion existant est `playerId`.
- Une reconnexion restaure l’état du joueur, y compris un éventuel `withdrawn` ; elle ne réintègre pas un joueur ayant abandonné.
- Les fonctions de classement doivent pouvoir être testées sans démarrer le serveur ni déclencher ses effets de bord.
- La précision sur `N` fixe et les places partagées prévaut sur la formulation initiale « le dernier reçoit 1 point » d’AGENTS.md : les points suivent `N - place + 1`, même après des abandons ou en cas d’égalité.

## Règles du projet et du mode Liste — copie intégrale d’AGENTS.md

La copie ci-dessous conserve toutes les règles durables, y compris les contraintes mobiles, de synchronisation, de vérification et les limites V1. Les précisions validées ci-dessus complètent ces règles ; les consignes actuelles placées en tête prévalent en cas de contradiction.

---

# AGENTS.md — Last Quiz Standing

## Objectif du projet

Last Quiz Standing est un jeu de quiz multijoueur en temps réel développé avec Node.js, Express et Socket.IO.

Le projet comporte actuellement un mode Battle Royale fonctionnel. Le prochain objectif est d’ajouter un second mode nommé « Liste ».

Les deux modes doivent coexister dans la même application et dans les mêmes fichiers, sans compromettre le fonctionnement du Battle Royale.

## Structure principale

Avant toute modification, vérifier les chemins réels dans le dépôt.

Les fichiers principaux sont normalement :

- `server.js` : serveur, salles, Socket.IO et logique des mini-jeux.
- `public_2/client.js` : logique du client, événements Socket.IO, animations et interface.
- `public_2/index.html` : structure HTML et styles CSS.
- `public_2/` : images, sons, JSON et assets des mini-jeux.
- `data/` : historique local des questions jouées.

Ne pas déplacer ou renommer ces fichiers sans autorisation explicite.

## Règle prioritaire

Le mode Battle Royale existant doit continuer à fonctionner comme avant.

Toute nouvelle logique doit être conditionnée par le mode de jeu :

- `battle_royale`
- `liste`

Ne jamais remplacer directement une logique Battle Royale par une logique Liste.

Préférer une séparation explicite, par exemple :

```js
if (gameMode === "battle_royale") {
  // comportement existant
} else if (gameMode === "liste") {
  // comportement du mode Liste
}
```

Les traitements complexes doivent progressivement être séparés dans des fonctions propres à chaque mode.
Règles du mode Liste
Le mode Liste est un tournoi sans élimination.
Configuration
L’hôte doit pouvoir :
- choisir le mode Battle Royale ou Liste ;
- choisir le nombre de mini-jeux ;
- demander une sélection entièrement aléatoire ;
- ou sélectionner manuellement les mini-jeux à utiliser.
En sélection manuelle, l’hôte choisit les mini-jeux, mais pas leur ordre.
L’ordre des mini-jeux sélectionnés doit être mélangé aléatoirement avant le début de la partie.
Un même mini-jeu ne doit pas être joué deux fois pendant une partie Liste.
Le nombre maximal de mini-jeux ne doit jamais être codé en dur. Il doit être calculé à partir de la liste des mini-jeux compatibles avec le mode Liste.
Mini-jeux compatibles
Pour la première version, sept mini-jeux sont compatibles.
les_encheres reste exclusivement réservé au Battle Royale. Ne pas le proposer dans le mode Liste tant qu’une version compatible n’a pas été développée.
L’architecture doit permettre d’ajouter plus tard quatre mini-jeux supplémentaires et une version Liste des Enchères, sans réécrire le système de sélection.
Classement d’un mini-jeu
Le classement d’un mini-jeu repose sur :
1. le score du mini-jeu, du plus élevé au plus faible ;
2. le temps du mini-jeu, du plus faible au plus élevé, en cas d’égalité.
Points du tournoi
À la fin de chaque mini-jeu :
- le premier reçoit N points ;
- le deuxième reçoit N - 1 points ;
- le troisième reçoit N - 2 points ;
- le dernier reçoit 1 point.
Les points sont ajoutés à un classement général distinct du score brut des mini-jeux.
Ne pas réutiliser le champ score existant pour les points du tournoi.
Utiliser des champs dédiés, par exemple :
- tournamentPoints
- tournamentTime
- tournamentPlacements
- withdrawn
Le serveur doit être la source d’autorité pour les scores, le classement et le vainqueur.
Égalité finale
En cas d’égalité de points au classement général, le joueur ayant le temps cumulé le plus faible sur l’ensemble des mini-jeux joués est classé devant.
Départ d’un joueur
Un joueur qui quitte une partie Liste ne doit pas être marqué comme éliminé.
Utiliser un état distinct tel que withdrawn.
Après son départ :
- il ne doit plus apparaître dans le classement général ;
- il ne doit plus apparaître dans les classements des mini-jeux suivants ;
- il ne doit plus recevoir de points ;
- son départ ne doit déclencher aucune animation d’élimination.
Ne pas utiliser eliminated pour représenter un abandon dans le mode Liste.
Animations du mode Liste
Le mode Liste peut réutiliser :
- l’animation de tirage d’un mini-jeu ;
- les animations de fin de mini-jeu compatibles ;
- l’animation finale annonçant le vainqueur de la partie.
Le mode Liste ne doit pas utiliser :
- l’introduction spécifique au Battle Royale ;
- l’annonce du joueur éliminé ;
- l’animation « EST À TERRE » ;
- l’emoji tête de mort du dernier joueur ;
- l’annonce des deux finalistes ;
- la finale Battle Royale des Enchères.
Le mode Liste doit recevoir un classement général cumulatif à la fin de chaque mini-jeu.

## Direction artistique et identité sonore

Le mode Liste doit conserver la direction artistique et l’identité sonore du Battle Royale existant. Cela comprend notamment l’image de fond, la palette de couleurs, les typographies, les cadres et cases des mini-jeux, les boutons, la barre de chronomètre, les animations d’interaction ainsi que les sons de clic, de validation et d’erreur.

Les nouvelles interfaces doivent réutiliser les composants, styles et assets existants lorsqu’ils sont compatibles. Elles doivent paraître natives au jeu et non appartenir à une nouvelle application.

Aucun remplacement ou retrait d’un asset visuel ou sonore existant ne doit être effectué sans autorisation. Les nouveaux styles nécessaires au mode Liste doivent rester isolés afin de ne pas modifier le rendu du Battle Royale.

Interface mobile
La majorité des joueurs utilisent un téléphone.
Toute nouvelle interface doit être conçue en priorité pour une utilisation mobile en orientation portrait.
Les nouveaux composants doivent :
- reprendre le format visuel du Battle Royale ;
- fonctionner entre 320 et 430 pixels de largeur ;
- ne provoquer aucun défilement horizontal ;
- avoir des boutons adaptés au tactile ;
- utiliser des dimensions responsives ;
- utiliser clamp() lorsque cela est pertinent ;
- rester lisibles avec des pseudonymes longs ;
- conserver un accès visible au bouton Quitter ;
- gérer un classement contenant plusieurs joueurs ;
- utiliser un défilement interne si le classement dépasse la hauteur disponible.
Ne pas modifier les styles généraux du Battle Royale pour adapter le mode Liste.
Isoler les nouveaux styles avec des classes propres au mode Liste, par exemple :
body.mode-liste .liste-leaderboard {
  /* styles propres au mode Liste */
}
Socket.IO et synchronisation
Les événements et données ajoutés doivent indiquer clairement le mode concerné.
Le gameMode doit être conservé côté serveur et transmis aux clients dans l’état sérialisé de la salle ou de la partie.
Les minuteries et callbacks différés doivent toujours vérifier :
- que la salle existe encore ;
- que la partie concernée est toujours active ;
- que le mode n’a pas changé ;
- que l’événement appartient encore à la manche courante.
Éviter les doubles appels de fin de mini-jeu et les événements obsolètes reçus après une transition.
Serveur local
Ne pas créer un deuxième serveur local.
Le serveur existant utilise déjà :
const PORT = process.env.PORT || 3000;
Avant de lancer le projet :
1. lire les scripts de package.json ;
2. utiliser npm ci si un package-lock.json valide existe ;
3. utiliser le script de démarrage prévu par le dépôt ;
4. ne pas ajouter ou mettre à jour une dépendance sans autorisation.
Méthode de travail
Avant toute modification :
1. lire les fonctions et événements concernés ;
2. vérifier git status ;
3. identifier les conséquences possibles sur le Battle Royale ;
4. présenter une courte proposition d’implémentation ;
5. signaler toute règle ambiguë avant de coder.
Pendant l’implémentation :
- travailler par petites étapes testables ;
- éviter les réécritures massives ;
- préserver les modifications déjà présentes ;
- ne pas supprimer une logique existante sans démontrer qu’elle est devenue inutile ;
- ne pas lancer de commande Git destructive ;
- ne pas pousser sur GitHub sans demande explicite ;
- ne pas mélanger une refactorisation générale avec l’ajout d’une fonctionnalité.
Vérifications obligatoires
Après chaque étape :
- vérifier la syntaxe des fichiers JavaScript modifiés ;
- exécuter les tests ou scripts disponibles ;
- lancer le serveur local ;
- contrôler les erreurs du serveur et de la console du navigateur ;
- tester avec plusieurs clients simultanés ;
- vérifier le résultat sur mobile en portrait ;
- retester le Battle Royale ;
- indiquer les fichiers modifiés et les vérifications réalisées.
Une tâche n’est pas terminée si le mode Liste fonctionne mais que le Battle Royale régresse.
Limites de la première version
La première version du mode Liste ne comprend pas :
- une version Liste des Enchères ;
- les quatre futurs mini-jeux ;
- une refonte générale des mini-jeux existants ;
- une modification du système de persistance des questions, sauf nécessité explicitement validée.

Ce fichier contient les règles durables. Les instructions spécifiques de chaque étape — par exemple « ajouter uniquement le choix du mode dans le lobby » — seront données dans les prompts successifs.
