const express = require('express');
const store = require('../store');
const { USERNAME_RE, hashPassword, verifyPassword, passwordError, createToken, requireAuth, publicUser } = require('../auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const user = USERNAME_RE.test(username) ? await store.get('users', username) : null;
  if (!user || !verifyPassword(req.body?.password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'Identifiants incorrects.' });
  }
  res.json({ token: createToken(user.username), user: publicUser(user) });
});

router.get('/me', requireAuth, (req, res) => {
  res.json(publicUser(req.user));
});

// Changer son propre mot de passe (admin comme étudiant)
router.put('/password', requireAuth, async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!verifyPassword(oldPassword || '', req.user.passwordHash)) {
    return res.status(400).json({ error: "L'ancien mot de passe est incorrect." });
  }
  const error = passwordError(newPassword);
  if (error) return res.status(400).json({ error });

  await store.set('users', req.user.username, {
    ...req.user,
    passwordHash: hashPassword(newPassword),
    passwordChangedAt: Date.now() // invalide les autres sessions ouvertes
  });
  res.json({ token: createToken(req.user.username) });
});

module.exports = router;
