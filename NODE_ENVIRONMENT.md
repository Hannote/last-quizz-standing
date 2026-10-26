# Environnement Node.js

Le projet CommonJS nécessite **Node.js >=24.22.1 et <25**. Node 24.22.1
est la version de sécurité retenue le 26 octobre 2026, après vérification de
l'[index officiel](https://nodejs.org/dist/index.json) et de l'[annonce de sécurité](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases).
`npm audit` contrôle les dépendances npm ; il ne vérifie pas les vulnérabilités du programme Node lui-même.

## Windows et VS Code

Depuis le dossier du projet, vérifier le programme réellement utilisé :

```powershell
Get-Command node | Select-Object Source
node --version
npm --version
npm ci
npm audit
npm start
```

Le serveur refuse un moteur incompatible avant de charger le jeu et ses historiques.
Il affiche sa version réelle dans le journal `[RUNTIME]`. Après une mise à jour
Windows, relancer les serveurs déjà en cours. Si un terminal conserve l'ancien
chemin ou l'ancienne version, fermer puis rouvrir le terminal et, si nécessaire, VS Code.
La contrainte du dépôt ne met pas à jour le programme installé sur Windows.

## Vérifications sans utiliser les historiques réels

`npm test` est encore le script d'échec par défaut. Exécuter les tests existants avec :

```powershell
node --test "test/*.test.js" "tests/*.test.cjs"
```

Pour les essais du serveur, utiliser des fichiers temporaires distincts pour les
deux historiques, dans un dossier déjà créé, et garder ces variables dans le seul
terminal d'essai :

```powershell
$testHistoryDir = Join-Path $env:TEMP ('lqs-check-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $testHistoryDir | Out-Null
$env:LQS_HISTORY_FILE = Join-Path $testHistoryDir 'played_questions_history.json'
$env:LQS_BON_ORDRE_MEMORY_FILE = Join-Path $testHistoryDir 'le_bon_ordre_elements_v1.json'
npm start
```

Ne pas lancer un second serveur si le port est déjà occupé. Ne pas copier, vider
ou réinitialiser les historiques réels pour les essais.

## Futur déploiement Railway

Aucun Dockerfile ni fichier Railway, Railpack ou Nixpacks n'est présent.
Avec Railpack, le `package.json` suffit à détecter Node, sélectionner une version
respectant `engines.node` et lancer `npm start`. Aucun fichier de sélection de
version supplémentaire n'est nécessaire.

Lors du futur déploiement, vérifier les variables du service :
`RAILPACK_NODE_VERSION` est prioritaire sur `engines.node`. La supprimer si elle
est inutile, ou choisir explicitement `24.22.1` ou une version corrigée ultérieure
de la branche 24. Vérifier aussi toute configuration prioritaire ajoutée entre-temps,
notamment `devEngines.runtime`. Une valeur limitée à `24` ne prouve pas que le
correctif est installé. Vérifier la version résolue dans les logs de construction
et le journal `[RUNTIME]` au démarrage.

Référence : [ordre de sélection Node dans Railpack](https://railpack.com/languages/node/).
Le stockage `/data`, les variables existantes et la persistance restent inchangés.
Cette préparation ne nécessite aucune connexion Railway, création de ressource,
réactivation ou mise en production.

## Résultats de l'intervention du 26 octobre 2026

- Installation Windows directe dans `C:\Program Files\nodejs` réellement mise à jour
  de **24.11.1 / npm 11.6.2** vers **24.22.1 / npm 11.19.1**. Aucun gestionnaire
  de versions ajouté. MSI officiel vérifié par SHA-256 et signature OpenJS ;
  installation avec élévation Windows terminée avec le code 0, sans redémarrage requis.
- `npm ci` réussi : 86 paquets installés, versions et intégrités du verrou inchangées.
- `npm audit` : **une vulnérabilité élevée** dans `body-parser@2.3.0`, dépendance
  d'Express, concernant un déni de service :
  [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828).
  Elle reste à traiter séparément ; aucun `audit fix` ni changement de dépendance effectué.
- Syntaxe de `server.js` et du nouveau test validée. Le démarrage réel sous
  Node 24.11.1 a été refusé avant chargement du jeu. Les trois nouveaux tests
  du contrôle de version réussissent.
- Suite complète : **191 réussites / 215 tests**, avec **24 échecs préexistants**.
  Comparaison avec `server.js` de Git avant modification et un ancien exécutable
  officiel Node 24.11.1 utilisé uniquement pour l'essai : **188 réussites / 212 tests**,
  exactement les mêmes 24 échecs. Aucun nouvel échec sur cette comparaison.
  `npm test` confirme le script d'échec par défaut.
- Serveur réellement lancé via `npm start` sous Node 24.22.1, avec les deux chemins
  d'historique temporaires. Interface, `client.js` et client Socket.IO : HTTP 200.
  Connexion Socket.IO réelle confirmée.
- Parcours Edge avec trois clients simultanés : création et jonction, lancement
  Battle Royale jusqu'à une question, lancement Liste, réponses et corrections,
  reconnexion de l'hôte et d'un invité dans les deux modes. Parcours Liste réussi.
  Ce contrôle ne constitue pas une partie complète de chaque mini-jeu.
- Mobile portrait 320/375/430 px : correction Liste sans débordement et bouton
  Quitter visible. Le lobby Battle Royale déborde à 320 et 375 px avec un pseudo
  de 32 caractères (largeur mesurée : 397 px). Le client et ses styles n'ont pas été modifiés.
- Aucune exception JavaScript de page dans Edge. Des messages console 404 sont
  présents ; le contrôle de chargement identifie `/favicon.ico` comme manquant.
  Aucune banque ni aucun média de remplacement créé.
- Le smoke Socket.IO existant attend le tirage Liste en 3 secondes, alors que
  l'introduction actuelle dure 16,5 secondes : son exécution initiale expire.
  Une copie temporaire avec une attente de 30 secondes réussit (Liste, règles,
  abandon puis lancement Battle Royale), sans changer le script du dépôt.
- Empreintes SHA-256 des fichiers `data/` inchangées après les essais.
  Aucun commit, push ou accès Railway effectué.

Les journaux et captures de cette intervention sont dans `.test-run/node-upgrade/`
(dossier ignoré par Git). Aucune opération manuelle n'est indispensable pour la
mise à jour locale ; rouvrir un terminal ou VS Code uniquement s'il conserve une
ancienne version. Vérifier les variables prioritaires lors du futur déploiement.
