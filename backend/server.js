const express = require('express');
const path = require('path');
const store = require('./store');
const { hashPassword } = require('./auth');

const app = express();
app.use(express.json());

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/orders', require('./routes/orders'));
app.get('/api/status', (req, res) => res.json({ storage: store.kind }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue.' }));

app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Erreurs inattendues : détail dans la console du serveur, message neutre pour le client
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON invalide.' });
  console.error(err);
  res.status(500).json({ error: 'Erreur interne du serveur.' });
});

// Au premier démarrage, il faut un administrateur pour pouvoir créer les autres comptes
async function ensureAdminExists() {
  const users = await store.list('users');
  if (users.some(u => u.role === 'admin')) return;

  await store.set('users', 'admin', {
    username: 'admin',
    name: 'Administrateur',
    role: 'admin',
    passwordHash: hashPassword(process.env.ADMIN_PASSWORD || 'admin'),
    createdAt: new Date().toISOString(),
    passwordChangedAt: 0
  });
  console.warn(` Compte créé : admin / ${process.env.ADMIN_PASSWORD ? '(valeur de ADMIN_PASSWORD)' : 'admin'}`);
  console.warn(' -> Changez ce mot de passe dès la première connexion.');
}

const PORT = process.env.PORT || 3000;

// ensureAdminExists vérifie aussi que le stockage répond avant d'accepter des requêtes
ensureAdminExists()
  .then(() => {
    app.listen(PORT, () => {
      console.log(` Serveur démarré : http://localhost:${PORT}`);
      console.log(` Stockage        : ${store.kind}`);
      if (!process.env.SESSION_SECRET) {
        console.log(' Sessions        : clé aléatoire (reconnexion nécessaire après un redémarrage)');
      }
    });
  })
  .catch(err => {
    console.error(`Impossible d'accéder au stockage (${store.kind}) : ${err.message}`);
    process.exit(1);
  });
