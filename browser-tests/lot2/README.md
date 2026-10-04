# Parcours navigateur du lot 2

Ces scripts Playwright pilotent Edge localement. Ils créent des contextes de navigateur indépendants pour les joueurs ; les onglets de reconnexion partagent uniquement le contexte du joueur remplacé. Ils n'ouvrent ni n'arrêtent le serveur.

## Préparation

1. Vérifier qu'aucun serveur préexistant n'écoute le port choisi.
2. Préparer une **copie temporaire isolée** de l'application (`server.js`, les modules locaux, `public_2/`, `package.json` et `package-lock.json`). Créer dans cette copie son propre `data/played_questions_history.json` contenant `{}`. Vérifier que `app/` et `app/data/` ne sont pas des liens vers le dépôt ni vers un volume de persistance partagé.
3. Installer les dépendances de l'application dans cette copie, puis lancer `npm start` depuis la copie. Installer Playwright dans un autre répertoire temporaire ; aucune dépendance de test n'est requise dans le dépôt.
4. Définir `LQS_TEST_BASE` sur le répertoire temporaire qui contient `app/`. Les captures et les rapports JSON seront enregistrés dans `LQS_TEST_BASE/captures/`. Définir `LQS_PLAYWRIGHT_MODULE` sur le chemin du module Playwright installé hors dépôt. `LQS_TEST_URL` vaut par défaut `http://127.0.0.1:3000/` et `LQS_BROWSER_PATH` vaut par défaut le chemin d'Edge sous Windows.

Exemple PowerShell, une fois la copie et le serveur prêts :

```powershell
$env:LQS_TEST_BASE = 'C:\chemin\vers\copie-temporaire'
$env:LQS_PLAYWRIGHT_MODULE = 'C:\chemin\vers\outils\node_modules\playwright'
node browser-tests/lot2/browser-run.cjs
node browser-tests/lot2/liste-run.cjs
node browser-tests/lot2/liste-finish.cjs
node browser-tests/lot2/pb-complete.cjs
node browser-tests/lot2/encheres-run.cjs
```

Exécuter les scripts **séquentiellement**. `browser-run.cjs` lance un Battle Royale normal à trois joueurs. Seul `encheres-run.cjs` active le bac à sable, pour atteindre directement les Enchères. La correction complète Liste et les Enchères attendent les chronos réels et peuvent prendre plusieurs minutes. Chaque script ferme ses pages ; arrêter ensuite uniquement le serveur lancé pour ces essais.

Les seules actions ciblées hors interface habituelle sont l'augmentation temporaire de `maxlength` dans le navigateur pour vérifier les pseudos de 32 et 33 caractères, et `requestRoomState` émis par l'ancien et le nouveau socket pour contrôler leur association. Les autres réponses, mises, votes, corrections et navigations passent par les boutons et champs visibles. Les rapports `*-report.json` indiquent les échecs et les erreurs console, page et réseau. Un scénario en échec donne un code de sortie non nul. Aucun script ne doit viser Railway ou un service externe.
