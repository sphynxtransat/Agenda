# GitHub Auto-Deploy

## Objectif

Publier automatiquement l'application des qu'un changement est pousse sur `main`.

## Ce que fait le workflow

- recupere le code depuis GitHub ;
- s'authentifie a Google Cloud avec un compte de service ;
- installe Firebase CLI ;
- deploie `firestore.rules` et `Hosting` sur `agenda-c6346`.

## Fichiers prepares

- `.github/workflows/deploy-firebase.yml`
- `.gitignore`

## Mise en place

1. Creer un repo GitHub.
2. Mettre le contenu de `projet_partagé` dans ce repo.
3. Creer la branche `main`.
4. Dans Firebase / Google Cloud, creer un compte de service avec acces de deploy Firebase.
5. Exporter la cle JSON du compte de service.
6. Dans GitHub :
   `Settings -> Secrets and variables -> Actions -> New repository secret`
7. Creer le secret :
   `FIREBASE_SERVICE_ACCOUNT_AGENDA_C6346`
8. Coller le JSON complet du compte de service dans ce secret.
9. Pousser sur `main`.

## Resultat

Chaque `git push origin main` declenche automatiquement le deploiement.

## Notes

- Android recuperera la nouvelle version via `https://agenda-c6346.web.app`.
- L'app Mac, si elle charge la version hebergee, recuperera aussi la nouvelle version au lancement.
- Aucune commande terminal n'est necessaire pour l'utilisateur final.
