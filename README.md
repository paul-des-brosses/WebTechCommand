# CommandesLab

Gestion des demandes de commandes de matériel entre étudiants et administrateurs.
Frontend Vue.js 3, API Express, données dans Cloud Firestore (ou dans un fichier local pour développer).

## Fonctionnalités

**Administrateur**
- crée les comptes (étudiants ou administrateurs), renomme, réinitialise le mot de passe, supprime
- accepte ou refuse les demandes
- fait avancer une demande acceptée : **Acceptée → Commandée → Archivée** (une fois la livraison reçue)
- modifie son mot de passe

**Étudiant**
- demande une commande (titre + objets avec nom, lien, prix)
- suit le statut et l'historique de ses demandes
- modifie son mot de passe

```
En attente ──► Acceptée ──► Commandée ──► Archivée
     └──────► Refusée
```

Seules ces transitions sont acceptées par le serveur.

## Démarrage

```bash
npm install
npm start
```

Ouvrir [http://localhost:3000](http://localhost:3000).

Au premier démarrage, un compte **admin / admin** est créé s'il n'existe aucun administrateur.
Changez ce mot de passe tout de suite (onglet « Mon mot de passe »), ou définissez `ADMIN_PASSWORD` avant le premier lancement.

Le terminal indique où sont stockées les données :

```
 Stockage        : Fichier local (data/db.json)
```

## Brancher Firestore

Sans configuration, les données vont dans `data/db.json`. Pour utiliser Firestore :

1. Console Firebase → *Paramètres du projet* → *Comptes de service* → **Générer une nouvelle clé privée**.
2. Enregistrer le fichier téléchargé sous `backend/serviceAccountKey.json`
   (ou indiquer son chemin dans la variable `GOOGLE_APPLICATION_CREDENTIALS`).
3. Console Firebase → *Firestore Database* → *Règles* : coller le contenu de [`firestore.rules`](firestore.rules) et publier.
4. Relancer `npm start` : le terminal doit afficher `Stockage : Firestore (<id-du-projet>)`.

> ⚠️ **Cette clé donne un accès total à la base.** Elle est dans le `.gitignore` : ne la committez jamais,
> ne l'envoyez à personne. Si elle fuit, révoquez-la dans la console.

Les règles `firestore.rules` interdisent **tout** accès depuis un navigateur. C'est voulu : seul le serveur
lit et écrit, avec le SDK `firebase-admin`, qui n'est pas soumis aux règles. Si le serveur n'arrive pas à
joindre Firestore au démarrage, il s'arrête avec un message d'erreur au lieu de continuer en silence.

## Sécurité

- Mots de passe hachés avec **scrypt** (sel aléatoire) ; ils ne sont jamais renvoyés au navigateur.
- À la connexion, le serveur délivre un **jeton signé** (HMAC-SHA256, valable 8 h) que le navigateur envoie à chaque requête.
- Le rôle est relu **en base** à chaque requête : modifier le navigateur ne donne aucun droit.
- Changer ou réinitialiser un mot de passe, ou supprimer un compte, invalide ses sessions ouvertes.
- Les liens des objets doivent commencer par `http://` ou `https://`.

Variables d'environnement facultatives :

| Variable | Rôle |
| :--- | :--- |
| `PORT` | Port d'écoute (3000 par défaut) |
| `SESSION_SECRET` | Clé de signature des jetons. Sans elle, une clé aléatoire est tirée à chaque démarrage et tout le monde doit se reconnecter après un redémarrage. **À définir en production.** |
| `ADMIN_PASSWORD` | Mot de passe du premier compte admin (sinon `admin`) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Chemin de la clé de compte de service, si elle n'est pas dans `backend/` |

## Structure

```text
backend/
  server.js          Express : routes, fichiers statiques, création du premier admin
  store.js           Stockage : Firestore (firebase-admin) ou fichier JSON local
  auth.js            Hachage des mots de passe, jetons de session, contrôle des rôles
  routes/
    auth.js          /api/auth   : connexion, profil, changement de mot de passe
    users.js         /api/users  : gestion des comptes (admin)
    orders.js        /api/orders : demandes et changements de statut
frontend/
  index.html         Interface (Vue.js 3)
  app.js             Logique de l'interface
  api.js             Appels à l'API avec le jeton de session
  style.css
firestore.rules      Règles Firestore (aucun accès client)
```

## API

Toutes les routes sauf `/api/auth/login` et `/api/status` exigent l'en-tête `Authorization: Bearer <jeton>`.

| Méthode | Route | Qui | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/login` | tous | Connexion, renvoie `{ token, user }` |
| `GET` | `/api/auth/me` | connecté | Profil de la session |
| `PUT` | `/api/auth/password` | connecté | `{ oldPassword, newPassword }`, renvoie un nouveau jeton |
| `GET` | `/api/orders` | connecté | Admin : toutes les demandes. Étudiant : les siennes |
| `POST` | `/api/orders` | étudiant | `{ title, items: [{ name, link, price }] }` |
| `PATCH` | `/api/orders/:id/status` | admin | `{ status }` selon les transitions ci-dessus |
| `GET` | `/api/users` | admin | Liste des comptes |
| `POST` | `/api/users` | admin | `{ username, name, password, role }` (`student` ou `admin`) |
| `PATCH` | `/api/users/:username` | admin | `{ name }` et/ou `{ password }` |
| `DELETE` | `/api/users/:username` | admin | Supprime le compte (ses demandes restent dans l'historique) |
| `GET` | `/api/status` | tous | Type de stockage utilisé |

## Déploiement

Le serveur Node doit tourner sur un hébergeur qui exécute du Node.js (Render, Railway, Fly.io…).
**GitHub Pages ne peut pas l'héberger** : Pages ne sert que des fichiers statiques.
Pensez à définir `SESSION_SECRET` et à fournir la clé de compte de service via les variables ou fichiers secrets de l'hébergeur.
