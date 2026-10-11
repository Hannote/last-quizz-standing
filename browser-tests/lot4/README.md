# Parcours Edge du lot 4

Ces scripts utilisent trois contextes Edge indépendants et l'interface du jeu. Ils ne lancent ni n'arrêtent le serveur. Les boutons des mini-jeux, corrections, Enchères et Quitter sont actionnés dans le navigateur. Seule la vérification de l'ancien socket dans `recovery.cjs` émet `requestRoomState` directement ; elle est signalée dans le rapport.

Préparer une copie temporaire de `server.js`, `liste-tournament.js`, `question-shuffle.js`, `public_2/`, `package.json` et `package-lock.json`. Ajouter dans cette copie un dossier `data/` indépendant avec `played_questions_history.json` contenant `{}`. Vérifier que la copie et son historique ne sont pas des liens vers le dépôt ou un volume partagé. Exécuter `npm ci` et `npm start` depuis cette copie sur un port libre. Installer Playwright hors du dépôt ; Edge doit être disponible localement.

Depuis le dépôt, avec PowerShell :

```powershell
$env:LQS_TEST_BASE = 'C:\chemin\vers\copie-temporaire'
$env:LQS_TEST_URL = 'http://127.0.0.1:3104/'
$env:LQS_PLAYWRIGHT_MODULE = 'C:\chemin\vers\playwright'
node browser-tests/lot4/full-liste.cjs
node browser-tests/lot4/full-br.cjs
node browser-tests/lot4/recovery.cjs
```

Exécuter les scripts séquentiellement. `full-liste.cjs` joue les sept mini-jeux choisis manuellement dans un ordre mélangé, avec réponses, corrections, points et classement final. `full-br.cjs` lance normalement un Battle Royale de trois joueurs jusqu'à l'élimination et la victoire aux Enchères. `recovery.cjs` vérifie les reconnexions en correction et au classement, l'abandon, le transfert d'hôte, le nouveau lobby et les deux méthodes de configuration.

Les rapports JSON sont écrits dans `LQS_TEST_BASE/captures/`. Les deux parcours complets enregistrent leur progression après chaque manche ou étape, avec des captures. Les chronomètres réels des mini-jeux et des Enchères peuvent allonger les essais. Arrêter ensuite uniquement le serveur démarré pour la copie.
