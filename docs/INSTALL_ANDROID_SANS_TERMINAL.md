# Android Sans Terminal

## Recommandation

Utiliser `Firebase Hosting + Firestore`.

Pourquoi :

- ton app utilise deja Firestore pour la synchro ;
- Firebase Hosting sert la PWA en HTTPS ;
- Android peut ensuite installer l'app depuis Chrome sans garder un terminal ouvert ;
- Mac et Android restent synchronises via la meme base Firestore.

## Resultat attendu

1. Tu deployes `shared/web` sur Firebase Hosting.
2. Tu ouvres l'URL HTTPS sur le Pixel 7a.
3. Dans Chrome Android : `Ajouter a l'ecran d'accueil` ou `Installer l'application`.
4. L'app s'ouvre ensuite seule, sans serveur local ni terminal ouvert.

## Setup rapide

1. Creer un projet Firebase.
2. Activer :
   - Hosting
   - Firestore Database
3. Copier `.firebaserc.example` en `.firebaserc`.
4. Remplacer le project id dans `.firebaserc`.
5. Deployer :

```bash
cd chemin/racine/projet_partagé
chmod +x scripts/deploy_firebase.command
./scripts/deploy_firebase.command
```

## Notes de synchro

- Le code actuel synchronise deja Mac et Android via Firestore.
- La synchro est bidirectionnelle : le dernier `updatedAt` gagne.
- Les regles fournies limitent deja l'acces au seul document `agendas/user-arcange`.
- Pour un usage multi-utilisateur, il faudra ajouter auth et regler les regles Firestore par utilisateur.

## Mac

Le shell Mac local peut continuer d'utiliser le meme Firestore distant.
Donc :

- Android n'a plus besoin du terminal ;
- Mac et Android restent synchronises via internet.
