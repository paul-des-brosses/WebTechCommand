const crypto = require('crypto');
const express = require('express');
const store = require('../store');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();
router.use(requireAuth);

// Cycle de vie d'une commande : seules ces transitions sont autorisées
const NEXT_STATUSES = {
  pending: ['approved', 'rejected'],
  approved: ['ordered'],
  ordered: ['archived'],
  rejected: [],
  archived: []
};

// Seuls les liens http(s) sont acceptés (pas de javascript:, data:, etc.)
function isWebLink(link) {
  try {
    return ['http:', 'https:'].includes(new URL(link).protocol);
  } catch {
    return false;
  }
}

// Renvoie { items } ou { error } à partir des objets envoyés par le navigateur
function parseItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > 50) {
    return { error: 'La commande doit contenir entre 1 et 50 objets.' };
  }
  const items = [];
  for (const raw of rawItems) {
    const name = String(raw?.name || '').trim();
    const link = String(raw?.link || '').trim();
    const price = Number(raw?.price);

    if (!name || name.length > 200) return { error: 'Chaque objet doit avoir un nom (200 caractères max).' };
    if (link && !isWebLink(link)) return { error: `Lien invalide pour « ${name} » : il doit commencer par http:// ou https://.` };
    if (raw?.price === '' || !Number.isFinite(price) || price < 0 || price > 1e6) return { error: `Prix invalide pour « ${name} ».` };

    items.push({ name, link, price: Math.round(price * 100) / 100 });
  }
  return { items };
}

// Admin : toutes les commandes. Étudiant : uniquement les siennes.
router.get('/', async (req, res) => {
  let orders = await store.list('orders');
  if (req.user.role !== 'admin') orders = orders.filter(o => o.student === req.user.username);
  orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(orders);
});

// Seuls les étudiants demandent des commandes
router.post('/', requireRole('student'), async (req, res) => {
  const title = String(req.body?.title || '').trim();
  if (!title || title.length > 120) {
    return res.status(400).json({ error: 'Le titre est obligatoire (120 caractères max).' });
  }
  const { items, error } = parseItems(req.body?.items);
  if (error) return res.status(400).json({ error });

  const now = new Date().toISOString();
  const order = {
    id: crypto.randomUUID(),
    title,
    student: req.user.username,
    studentName: req.user.name,
    items,
    total: Math.round(items.reduce((sum, item) => sum + item.price, 0) * 100) / 100,
    status: 'pending',
    createdAt: now,
    history: [{ status: 'pending', at: now, by: req.user.username }]
  };
  await store.set('orders', order.id, order);
  res.status(201).json(order);
});

router.patch('/:id/status', requireRole('admin'), async (req, res) => {
  const order = await store.get('orders', req.params.id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable.' });

  const status = req.body?.status;
  if (!NEXT_STATUSES[order.status].includes(status)) {
    return res.status(400).json({ error: `Transition impossible : « ${order.status} » vers « ${status} ».` });
  }

  order.status = status;
  order.history.push({ status, at: new Date().toISOString(), by: req.user.username });
  await store.set('orders', order.id, order);
  res.json(order);
});

module.exports = router;
