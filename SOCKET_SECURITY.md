# Messages de jeu, créations de salles et participants

Les messages de question Socket.IO de Faux du Vrai, Leugtas, Blind Test,
Tour du Monde et Qui suis-je utilisent des projections publiques communes aux
envois initiaux, questions suivantes et reconnexions. Seuls les textes, choix
et médias de question nécessaires au client sont transmis. Les choix Leugtas
contiennent uniquement `id` et `text`. Les réponses et médias de correction
restent accessibles dans les événements de révélation/correction prévus.
Les banques JSON publiques et les noms des médias restent hors de ce périmètre.

| Message | Champs de question utilisés par le client |
| --- | --- |
| `fauxVraiQuestion` | `question`, `affirmations[]`, `themeId`, `duration`, `index`, `total` ; à la reconnexion, `hasAnswered`, `selectedAnswerIndex`, `isReload` pour son propre choix |
| `leugtasQuestion` | `question.question`, `question.answers[].id`, `question.answers[].text`, `index`, `total`, `isReload` |
| `blindTestQuestion` | `question.text`, `question.audio`, `themeName`, `index`, `total` |
| `leTourDuMondeQuestion` | `question.text`, `question.image`, `themeName`, `index`, `total` |
| `quiSuisJeQuestion` | `question.question`, `question.image_question`, `index`, `total` |

Lors d'une reconnexion pendant une révélation, le serveur envoie la question
publique puis l'événement de révélation déjà autorisé pour cette question.
Les corrections manuelles utilisent toujours `correctionUpdate` et les données
complètes conservées côté serveur.

## Quota de création

Le quota est partagé par les connexions et identités d'une même adresse réseau.
Il est local au processus serveur et n'est pas réinitialisé par un nouvel onglet,
un départ de salle ou une reconnexion.

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `LQS_ROOM_CREATE_LIMIT` | `20` | Créations réussies par source pendant la fenêtre |
| `LQS_ROOM_CREATE_WINDOW_MS` | `60000` | Fenêtre glissante, en millisecondes |
| `LQS_ROOM_CREATE_MAX_SOURCES` | `10000` | Nombre maximal de sources suivies |
| `LQS_TRUSTED_PROXIES` | vide | Adresses IP/CIDR de proxies de confiance, séparées par des virgules |
| `LQS_ROOM_LIMIT` | `100` | Plafond global de salles simultanées, conservé |
| `LQS_ROOM_ABANDON_MS` | `300000` | Délai existant de nettoyage d'une salle abandonnée |

Par défaut, les en-têtes d'adresse sont ignorés et la source est l'adresse du
socket réseau. Derrière un proxy, renseigner uniquement les adresses/réseaux
réellement utilisés par l'infrastructure dans `LQS_TRUSTED_PROXIES`.
La chaîne `X-Forwarded-For` est remontée de droite à gauche, à partir du pair
réseau, jusqu'au premier relais non approuvé. Un en-tête invalide est ignoré.
Les adresses IPv4, IPv4 encapsulées dans IPv6 et IPv6 sont normalisées.
Ce réglage concerne ce quota Socket.IO ; il ne modifie pas les paramètres
HTTP généraux d'Express.

Ce choix suit le principe décrit dans la [documentation Express sur les proxies](https://expressjs.com/en/guide/behind-proxies/).
Les réseaux approuvés utilisent `node:net.BlockList`, sans dépendance supplémentaire.

Les entrées expirées sont supprimées à chaque tentative de création. Chaque
source conserve au plus le nombre de dates autorisé par son quota. Si le suivi
est plein, une nouvelle source reçoit un refus temporaire explicite ; aucune
source active n'est évincée pour contourner sa limite. Les refus et les salles
impossibles à créer ne consomment pas de quota. Le compteur est en mémoire et
repart à zéro lors d'un redémarrage du processus.

## Battle Royale

La liste `battleRoyaleParticipantIds` est figée dès le lancement, avant
l'introduction. Une nouvelle identité arrivée ensuite est spectatrice. Les
reconnexions vérifiées réutilisent le joueur existant, ses scores, ses temps
et son éventuelle élimination. Les réponses, joueurs prêts, classements,
éliminations et finalistes utilisent les participants actifs de cette liste.
Quitter en tant que spectateur ne déclenche aucune transition de partie.
Les règles de participation du mode Liste restent celles de son tournoi.

## Vérifications locales

Tests ciblés :

```powershell
node --test --experimental-test-isolation=none test/question-snapshots.test.js test/room-creation-quota.test.js test/battle-royale-participants.test.js
```

`browser-tests/socket-hardening.cjs` utilise un Firefox Playwright dédié,
avec un contexte par joueur et spectateur. Il attend un serveur local déjà
lancé via `npm start`, avec `LQS_HISTORY_FILE` et `LQS_BON_ORDRE_MEMORY_FILE`
pointant vers des fichiers de test distincts. Ne pas lancer un deuxième serveur.
Installer l'outillage Playwright hors des dépendances de l'application et définir
`LQS_PLAYWRIGHT_MODULE` ainsi que `PLAYWRIGHT_BROWSERS_PATH` si nécessaire.
Les rapports et captures sont enregistrés dans `.test-run/socket-hardening/firefox`.
Le script refuse les URLs non locales. `LQS_TEST_GAMES` et `LQS_TEST_MODES`
permettent de limiter une reprise à des valeurs séparées par des virgules.
