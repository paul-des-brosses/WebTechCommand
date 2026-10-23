import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  initializeAuth, browserSessionPersistence, inMemoryPersistence, onAuthStateChanged,
  signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword, sendPasswordResetEmail,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc, onSnapshot, query, where, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const { createApp, ref, reactive, computed } = Vue;

const firebaseApp = initializeApp(firebaseConfig);
// Session limitée à l'onglet : personne ne reste connecté sur un ordinateur partagé
const auth = initializeAuth(firebaseApp, { persistence: browserSessionPersistence });
const db = getFirestore(firebaseApp);

// Créer un compte avec Firebase Auth connecte aussitôt ce nouveau compte. On le fait donc
// sur une deuxième instance, gardée en mémoire, pour que l'admin reste connecté.
const creationAuth = initializeAuth(initializeApp(firebaseConfig, 'creation-comptes'), { persistence: inMemoryPersistence });

const STATUSES = {
  pending: { label: 'En attente', css: 'bg-amber-50 text-amber-800 border-amber-200' },
  approved: { label: 'Acceptée', css: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  ordered: { label: 'Commandée', css: 'bg-sky-50 text-sky-800 border-sky-200' },
  archived: { label: 'Archivée', css: 'bg-slate-100 text-slate-600 border-slate-200' },
  rejected: { label: 'Refusée', css: 'bg-rose-50 text-rose-800 border-rose-200' }
};

// Boutons proposés à l'admin selon le statut (firestore.rules applique les mêmes transitions)
const ACTIONS = {
  pending: [
    { to: 'approved', label: 'Accepter', css: 'bg-emerald-600 hover:bg-emerald-700 text-white' },
    { to: 'rejected', label: 'Refuser', css: 'bg-white hover:bg-rose-50 text-rose-700 border border-rose-200', confirm: 'Refuser cette commande ?' }
  ],
  approved: [{ to: 'ordered', label: 'Marquer comme commandée', css: 'bg-sky-600 hover:bg-sky-700 text-white' }],
  ordered: [{ to: 'archived', label: 'Livraison reçue : archiver', css: 'bg-slate-700 hover:bg-slate-800 text-white', confirm: 'Confirmer la réception et archiver la commande ?' }]
};

const FILTERS = [
  { id: 'active', label: 'En cours', statuses: ['pending', 'approved', 'ordered'] },
  ...Object.entries(STATUSES).map(([id, s]) => ({ id, label: s.label, statuses: [id] })),
  { id: 'all', label: 'Toutes', statuses: Object.keys(STATUSES) }
];

const TABS = {
  admin: [
    { id: 'orders', label: 'Commandes' },
    { id: 'accounts', label: 'Comptes' },
    { id: 'password', label: 'Mon mot de passe' }
  ],
  student: [
    { id: 'new', label: 'Nouvelle demande' },
    { id: 'orders', label: 'Mes demandes' },
    { id: 'password', label: 'Mon mot de passe' }
  ]
};

const ERRORS = {
  'auth/invalid-credential': 'E-mail ou mot de passe incorrect.',
  'auth/invalid-login-credentials': 'E-mail ou mot de passe incorrect.',
  'auth/wrong-password': 'E-mail ou mot de passe incorrect.',
  'auth/user-not-found': 'E-mail ou mot de passe incorrect.',
  'auth/invalid-email': 'Adresse e-mail invalide.',
  'auth/missing-password': 'Mot de passe manquant.',
  'auth/email-already-in-use': 'Un compte existe déjà avec cette adresse.',
  'auth/weak-password': 'Mot de passe trop faible (6 caractères minimum).',
  'auth/too-many-requests': 'Trop de tentatives, réessayez dans quelques minutes.',
  'auth/network-request-failed': 'Impossible de joindre Firebase (connexion réseau).',
  'auth/operation-not-allowed': "La connexion par e-mail n'est pas activée dans Firebase (Authentication > Sign-in method).",
  'permission-denied': 'Action refusée par les règles de sécurité.'
};

const errorMessage = err => ERRORS[err?.code] || err?.message || 'Erreur inattendue.';
const emptyItem = () => ({ name: '', link: '', price: '' });
const isWebLink = link => /^https?:\/\//i.test(link || '');
const createdAt = order => order.dates?.pending?.toMillis() ?? 0;

createApp({
  setup() {
    const ready = ref(false);
    const me = ref(null);
    const tab = ref('');
    const orders = ref([]);
    const users = ref([]);
    const filter = ref('active');
    const search = ref('');
    const busy = ref(false);
    const toasts = ref([]);

    const loginForm = reactive({ email: '', password: '', error: '' });
    const orderForm = reactive({ title: '', items: [emptyItem()] });
    const accountForm = reactive({ email: '', name: '', password: '', role: 'student' });
    const passwordForm = reactive({ oldPassword: '', newPassword: '', confirm: '' });

    const isAdmin = computed(() => me.value?.role === 'admin');
    const tabs = computed(() => (me.value ? TABS[me.value.role] : []));

    // Le total est toujours recalculé à partir des objets : un total enregistré pourrait être faux
    const total = items => items.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
    const draftTotal = computed(() => total(orderForm.items));

    const counts = computed(() =>
      Object.fromEntries(FILTERS.map(f => [f.id, orders.value.filter(o => f.statuses.includes(o.status)).length]))
    );

    const visibleOrders = computed(() => {
      const statuses = FILTERS.find(f => f.id === filter.value).statuses;
      const q = search.value.trim().toLowerCase();
      return orders.value.filter(o =>
        statuses.includes(o.status) &&
        (!q || [o.title, o.studentName].some(text => text?.toLowerCase().includes(q)))
      );
    });

    // Étapes franchies, dans l'ordre du cycle de vie
    function historyOf(order) {
      return ['pending', 'approved', 'rejected', 'ordered', 'archived']
        .filter(status => order.dates?.[status])
        .map(status => ({ status, at: order.dates[status] }));
    }

    // --- Utilitaires ---

    function toast(message, type = 'success') {
      const id = Date.now() + Math.random();
      toasts.value.push({ id, message, type });
      setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id); }, 5000);
    }

    // Exécute une action en empêchant le double clic, et affiche le résultat
    async function run(action, successMessage) {
      if (busy.value) return;
      busy.value = true;
      try {
        await action();
        if (successMessage) toast(successMessage);
      } catch (err) {
        toast(errorMessage(err), 'error');
      } finally {
        busy.value = false;
      }
    }

    function formatDate(timestamp) {
      if (!timestamp) return '…';
      return timestamp.toDate().toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function formatPrice(value) {
      return `${Number(value || 0).toFixed(2)} €`;
    }

    // --- Données en temps réel ---

    let unsubscribers = [];

    function stopListening() {
      unsubscribers.forEach(unsubscribe => unsubscribe());
      unsubscribers = [];
      orders.value = [];
      users.value = [];
    }

    // Typiquement : le compte vient d'être désactivé, les règles refusent désormais tout
    function onListenError(err) {
      toast(errorMessage(err), 'error');
      signOut(auth);
    }

    function listen() {
      const ordersQuery = isAdmin.value
        ? collection(db, 'orders')
        : query(collection(db, 'orders'), where('studentUid', '==', me.value.uid));

      unsubscribers.push(onSnapshot(ordersQuery, snap => {
        orders.value = snap.docs
          .map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))
          .sort((a, b) => createdAt(b) - createdAt(a));
      }, onListenError));

      if (isAdmin.value) {
        unsubscribers.push(onSnapshot(collection(db, 'users'), snap => {
          users.value = snap.docs
            .map(d => ({ uid: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))
            .sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
        }, onListenError));
      }
    }

    // --- Session ---

    onAuthStateChanged(auth, async user => {
      stopListening();
      me.value = null;
      if (user) {
        try {
          const snap = await getDoc(doc(db, 'users', user.uid));
          if (snap.exists() && snap.data().active) {
            me.value = { uid: user.uid, ...snap.data() };
            tab.value = TABS[me.value.role][0].id;
            filter.value = 'active';
            search.value = '';
            listen();
          } else {
            loginForm.error = "Ce compte n'a pas accès au site (profil absent ou désactivé). Contactez un administrateur.";
            await signOut(auth);
          }
        } catch (err) {
          loginForm.error = errorMessage(err);
          await signOut(auth);
        }
      }
      ready.value = true;
    });

    async function login() {
      loginForm.error = '';
      try {
        await signInWithEmailAndPassword(auth, loginForm.email.trim(), loginForm.password);
        loginForm.password = '';
      } catch (err) {
        loginForm.error = errorMessage(err);
      }
    }

    async function forgotPassword() {
      loginForm.error = '';
      if (!loginForm.email.trim()) {
        loginForm.error = 'Saisissez votre adresse e-mail ci-dessus, puis cliquez à nouveau.';
        return;
      }
      try {
        await sendPasswordResetEmail(auth, loginForm.email.trim());
        toast("Si un compte existe pour cette adresse, un e-mail de réinitialisation vient d'être envoyé.");
      } catch (err) {
        loginForm.error = errorMessage(err);
      }
    }

    function logout() {
      signOut(auth);
    }

    // --- Étudiant : demande de commande ---

    function addItem() {
      orderForm.items.push(emptyItem());
    }

    function removeItem(index) {
      if (orderForm.items.length > 1) orderForm.items.splice(index, 1);
    }

    function submitOrder() {
      const badLink = orderForm.items.find(item => item.link.trim() && !isWebLink(item.link.trim()));
      if (badLink) {
        toast(`Le lien de « ${badLink.name} » doit commencer par http:// ou https://.`, 'error');
        return;
      }
      return run(async () => {
        await addDoc(collection(db, 'orders'), {
          title: orderForm.title.trim(),
          studentUid: me.value.uid,
          studentName: me.value.name,
          items: orderForm.items.map(item => ({
            name: item.name.trim(),
            link: item.link.trim(),
            price: Math.round(Number(item.price) * 100) / 100
          })),
          status: 'pending',
          dates: { pending: serverTimestamp() }
        });
        orderForm.title = '';
        orderForm.items = [emptyItem()];
        tab.value = 'orders';
      }, 'Demande envoyée.');
    }

    // --- Admin : commandes ---

    function setStatus(order, action) {
      if (action.confirm && !confirm(action.confirm)) return;
      return run(
        () => updateDoc(doc(db, 'orders', order.id), { status: action.to, [`dates.${action.to}`]: serverTimestamp() }),
        `Commande « ${order.title} » : ${STATUSES[action.to].label.toLowerCase()}.`
      );
    }

    // --- Admin : comptes ---

    function createAccount() {
      return run(async () => {
        const email = accountForm.email.trim().toLowerCase();
        const { user } = await createUserWithEmailAndPassword(creationAuth, email, accountForm.password);
        await signOut(creationAuth);
        await setDoc(doc(db, 'users', user.uid), {
          email,
          name: accountForm.name.trim(),
          role: accountForm.role,
          active: true,
          createdAt: serverTimestamp()
        });
        Object.assign(accountForm, { email: '', name: '', password: '', role: 'student' });
      }, 'Compte créé.');
    }

    function renameAccount(user) {
      const name = prompt(`Nouveau nom pour ${user.email} :`, user.name);
      if (name === null || !name.trim()) return;
      return run(() => updateDoc(doc(db, 'users', user.uid), { name: name.trim().slice(0, 80) }), 'Nom modifié.');
    }

    function sendReset(user) {
      return run(() => sendPasswordResetEmail(auth, user.email), `E-mail de réinitialisation envoyé à ${user.email}.`);
    }

    function toggleAccount(user) {
      if (user.active && !confirm(`Désactiver ${user.name} ? Le compte ne pourra plus rien faire sur le site.`)) return;
      return run(
        () => updateDoc(doc(db, 'users', user.uid), { active: !user.active }),
        user.active ? 'Compte désactivé.' : 'Compte réactivé.'
      );
    }

    // --- Tous : mot de passe ---

    function changePassword() {
      if (passwordForm.newPassword !== passwordForm.confirm) {
        toast('Les deux nouveaux mots de passe ne correspondent pas.', 'error');
        return;
      }
      return run(async () => {
        const user = auth.currentUser;
        try {
          await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, passwordForm.oldPassword));
        } catch (err) {
          if (ERRORS[err.code]?.startsWith('E-mail ou mot de passe')) throw new Error('Le mot de passe actuel est incorrect.');
          throw err;
        }
        await updatePassword(user, passwordForm.newPassword);
        Object.assign(passwordForm, { oldPassword: '', newPassword: '', confirm: '' });
      }, 'Mot de passe modifié.');
    }

    return {
      STATUSES, ACTIONS, FILTERS,
      ready, me, tab, tabs, orders, users, filter, search, busy, toasts,
      loginForm, orderForm, accountForm, passwordForm,
      isAdmin, draftTotal, counts, visibleOrders,
      total, historyOf, formatDate, formatPrice, isWebLink,
      login, forgotPassword, logout, addItem, removeItem, submitOrder, setStatus,
      createAccount, renameAccount, sendReset, toggleAccount, changePassword
    };
  }
}).mount('#app');
