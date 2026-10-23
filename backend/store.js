// Stockage des données.
// - Si une clé de compte de service Firebase est présente : Cloud Firestore via firebase-admin
//   (le SDK admin passe au-dessus des règles de sécurité, le navigateur n'accède jamais à la base).
// - Sinon : un fichier JSON local, pratique pour développer sans Firebase.
// Les deux exposent la même interface : get / list / set / remove.
const fs = require('fs');
const path = require('path');

const KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, 'serviceAccountKey.json');
const DATA_FILE = path.join(__dirname, '..', 'data', 'db.json');

function firestoreStore() {
  const { initializeApp, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const key = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
  const db = getFirestore(initializeApp({ credential: cert(key) }));

  return {
    kind: `Firestore (${key.project_id})`,
    async get(col, id) {
      const snap = await db.collection(col).doc(id).get();
      return snap.exists ? snap.data() : null;
    },
    async list(col) {
      const snap = await db.collection(col).get();
      return snap.docs.map(doc => doc.data());
    },
    async set(col, id, data) {
      await db.collection(col).doc(id).set(data);
    },
    async remove(col, id) {
      await db.collection(col).doc(id).delete();
    }
  };
}

function fileStore() {
  const data = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) : {};

  function save() {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(data, null, 2));
    fs.renameSync(DATA_FILE + '.tmp', DATA_FILE); // écriture atomique
  }

  // On renvoie des copies pour qu'une modification côté route ne change pas la base sans set()
  return {
    kind: 'Fichier local (data/db.json)',
    async get(col, id) {
      return data[col] && Object.hasOwn(data[col], id) ? structuredClone(data[col][id]) : null;
    },
    async list(col) {
      return Object.values(data[col] || {}).map(doc => structuredClone(doc));
    },
    async set(col, id, doc) {
      (data[col] ??= {})[id] = structuredClone(doc);
      save();
    },
    async remove(col, id) {
      if (data[col]) delete data[col][id];
      save();
    }
  };
}

module.exports = fs.existsSync(KEY_PATH) ? firestoreStore() : fileStore();
