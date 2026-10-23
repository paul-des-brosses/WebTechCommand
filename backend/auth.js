// Mots de passe (hachés avec scrypt) et sessions (jetons signés HMAC).
const crypto = require('crypto');
const store = require('./store');

// Sans SESSION_SECRET, la clé change à chaque démarrage : il faudra se reconnecter après un redémarrage.
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

const USERNAME_RE = /^[a-z0-9._-]{2,32}$/;
const MIN_PASSWORD_LENGTH = 6;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  return crypto.timingSafeEqual(expected, crypto.scryptSync(String(password), salt, expected.length));
}

// Renvoie un message d'erreur, ou null si le mot de passe est acceptable
function passwordError(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Le mot de passe doit comporter au moins ${MIN_PASSWORD_LENGTH} caractères.`;
  }
  if (password.length > 200) return 'Le mot de passe est trop long.';
  return null;
}

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

function createToken(username) {
  const payload = Buffer.from(JSON.stringify({ u: username, iat: Date.now() })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function readToken(token) {
  const [payload, signature] = String(token).split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return Date.now() - data.iat < SESSION_DURATION_MS ? data : null;
  } catch {
    return null;
  }
}

// Charge l'utilisateur à partir du jeton. Le rôle vient toujours de la base, jamais du navigateur.
// Un compte supprimé, ou un jeton émis avant un changement de mot de passe, est refusé.
async function requireAuth(req, res, next) {
  const data = readToken((req.headers.authorization || '').replace(/^Bearer /, ''));
  const user = data && await store.get('users', data.u);
  if (!user || data.iat < (user.passwordChangedAt || 0)) {
    return res.status(401).json({ error: 'Session invalide ou expirée, reconnectez-vous.' });
  }
  req.user = user;
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role) return res.status(403).json({ error: 'Action non autorisée pour ce compte.' });
    next();
  };
}

// Ce qui peut être envoyé au navigateur : jamais le hash du mot de passe
function publicUser(user) {
  return { username: user.username, name: user.name, role: user.role, createdAt: user.createdAt };
}

module.exports = {
  USERNAME_RE,
  hashPassword,
  verifyPassword,
  passwordError,
  createToken,
  requireAuth,
  requireRole,
  publicUser
};
