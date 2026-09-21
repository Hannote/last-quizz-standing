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
