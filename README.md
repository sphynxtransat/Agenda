# Projet Partage

Base de code partagee pour maintenir la synchro Mac et Android.

## Structure

- `docs/`
  Documentation projet, installation et auto-deploiement.
- `scripts/`
  Scripts de sync locale, watch et deploy.
- `firebase.json`, `firestore.rules`, `.firebaserc*`
  Configuration Firebase gardee a la racine pour la CLI.
- `shared/web/`
  Point de verite pour le socle web commun et version a deployer pour Android.
- `platforms/mac/`
  Fichiers specifiques Mac.
- `platforms/android/`
  Fichiers specifiques Android.

## Regle de synchro

1. Toute evolution fonctionnelle commune part de `shared/web/index.html`.
2. Les adaptations specifiques plateforme restent dans `platforms/mac` et `platforms/android`.
3. Toute demande de modif Mac doit etre analysee puis reportee vers Android avant cloture.
4. Android sans terminal passe par un hebergement HTTPS de `shared/web`.

## Recommandation de prod

Choix conseille : `Firebase Hosting + Firestore`.

Pourquoi :

- Firestore est deja integre dans le code ;
- Firebase Hosting permet d'installer la PWA sur Android sans serveur local ;
- Mac et Android peuvent se synchroniser sur la meme base distante.

Voir : `docs/INSTALL_ANDROID_SANS_TERMINAL.md`

## Securite Firestore

- Le projet inclut maintenant `firestore.rules`.
- Les regles n'autorisent que le document `agendas/user-arcange` utilise par l'app.
- Tout le reste de la base Firestore est refuse.

## Deploiement pro

La voie recommandee est maintenant :

- source dans GitHub ;
- deploiement automatique via GitHub Actions ;
- publication automatique sur Firebase Hosting a chaque push sur `main`.

Voir : `docs/GITHUB_AUTODEPLOY.md`

## Base importee

- Socle web importe depuis la version Android synchronisee.
- Shell natif Mac importe depuis `AgendaApp.app`.
- Support Android importe depuis `AgendaAndroid`.

## Auto-update local

Pour propager automatiquement les changements faits ici :

```bash
cd "/Users/Arcangelo/Desktop/AI/Création APP/VSC/AGENDA/chemin/racine/projet_partagé"
chmod +x scripts/sync_shared.command scripts/watch_updates.command scripts/deploy_firebase.command
./scripts/watch_updates.command
```

Options utiles :

- `AUTO_DEPLOY_FIREBASE=1 ./scripts/watch_updates.command`
  pousse aussi chaque changement vers Firebase Hosting.
- `SYNC_INSTALLED_MAC_APP=1 ./scripts/watch_updates.command`
  recopie aussi les changements dans `/Applications/AgendaApp.app` si l'app est installee.
- `AUTO_DEPLOY_FIREBASE=1 SYNC_INSTALLED_MAC_APP=1 ./scripts/watch_updates.command`
  mode le plus proche du "ça se met a jour tout seul" sur Android et Mac.
