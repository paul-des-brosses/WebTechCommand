// Gestion des comptes : réservée aux administrateurs
const express = require('express');
const store = require('../store');
const { USERNAME_RE, hashPassword, passwordError, requireAuth, requireRole, publicUser } = require('../auth');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

const ROLES = ['student', 'admin'];

function nameError(name) {
  const length = typeof name === 'string' ? name.trim().length : 0;
  return length >= 1 && length <= 80 ? null : 'Le nom doit comporter entre 1 et 80 caractères.';
}

// Charge le compte visé par :username ; on ne gère pas son propre compte ici (voir /api/auth/password)
async function loadTarget(req, res) {
  if (req.params.username === req.user.username) {
    res.status(400).json({ error: 'Utilisez « Mon mot de passe » pour votre propre compte.' });
    return null;
  }
  const target = USERNAME_RE.test(req.params.username) ? await store.get('users', req.params.username) : null;
  if (!target) res.status(404).json({ error: 'Compte introuvable.' });
  return target;
}

router.get('/', async (req, res) => {
  const users = await store.list('users');
  users.sort((a, b) => a.role.localeCompare(b.role) || a.username.localeCompare(b.username));
  res.json(users.map(publicUser));
});

router.post('/', async (req, res) => {
  const { name, password, role = 'student' } = req.body || {};
  const username = String(req.body?.username || '').trim().toLowerCase();

  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Identifiant invalide : 2 à 32 caractères parmi a-z, 0-9, « . », « _ » et « - ».' });
  }
  const error = nameError(name) || passwordError(password) || (ROLES.includes(role) ? null : 'Rôle invalide.');
  if (error) return res.status(400).json({ error });
  if (await store.get('users', username)) {
    return res.status(409).json({ error: 'Cet identifiant est déjà utilisé.' });
  }

  const user = {
    username,
    name: name.trim(),
    role,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
    passwordChangedAt: 0
  };
  await store.set('users', username, user);
  res.status(201).json(publicUser(user));
});

// Modifier le nom et/ou réinitialiser le mot de passe d'un compte
router.patch('/:username', async (req, res) => {
  const target = await loadTarget(req, res);
  if (!target) return;
  const { name, password } = req.body || {};

  if (name !== undefined) {
    const error = nameError(name);
    if (error) return res.status(400).json({ error });
    target.name = name.trim();
  }
  if (password !== undefined) {
    const error = passwordError(password);
    if (error) return res.status(400).json({ error });
    target.passwordHash = hashPassword(password);
    target.passwordChangedAt = Date.now(); // déconnecte ce compte partout
  }

  await store.set('users', target.username, target);
  res.json(publicUser(target));
});

// Les commandes du compte restent dans l'historique
router.delete('/:username', async (req, res) => {
  const target = await loadTarget(req, res);
  if (!target) return;
  await store.remove('users', target.username);
  res.status(204).end();
});

module.exports = router;
