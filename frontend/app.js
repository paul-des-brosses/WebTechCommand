const { createApp, ref, reactive, computed, onMounted } = Vue;

const STATUSES = {
  pending: { label: 'En attente', css: 'bg-amber-50 text-amber-800 border-amber-200' },
  approved: { label: 'Acceptée', css: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  ordered: { label: 'Commandée', css: 'bg-sky-50 text-sky-800 border-sky-200' },
  archived: { label: 'Archivée', css: 'bg-slate-100 text-slate-600 border-slate-200' },
  rejected: { label: 'Refusée', css: 'bg-rose-50 text-rose-800 border-rose-200' }
};

// Boutons proposés à l'admin selon le statut (le serveur applique les mêmes transitions)
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

const emptyItem = () => ({ name: '', link: '', price: '' });

createApp({
  setup() {
    const me = ref(null);
    const storage = ref('');
    const tab = ref('');
    const orders = ref([]);
    const users = ref([]);
    const filter = ref('active');
    const search = ref('');
    const busy = ref(false);
    const toasts = ref([]);

    const loginForm = reactive({ username: '', password: '', error: '' });
    const orderForm = reactive({ title: '', items: [emptyItem()] });
    const accountForm = reactive({ username: '', name: '', password: '', role: 'student' });
    const passwordForm = reactive({ oldPassword: '', newPassword: '', confirm: '' });

    const isAdmin = computed(() => me.value?.role === 'admin');
    const tabs = computed(() => (me.value ? TABS[me.value.role] : []));

    const orderTotal = computed(() =>
      orderForm.items.reduce((sum, item) => sum + (Number(item.price) || 0), 0)
    );

    const counts = computed(() =>
      Object.fromEntries(FILTERS.map(f => [f.id, orders.value.filter(o => f.statuses.includes(o.status)).length]))
    );

    const visibleOrders = computed(() => {
      const statuses = FILTERS.find(f => f.id === filter.value).statuses;
      const q = search.value.trim().toLowerCase();
      return orders.value.filter(o =>
        statuses.includes(o.status) &&
        (!q || [o.title, o.student, o.studentName].some(text => text?.toLowerCase().includes(q)))
      );
    });

    // --- Utilitaires ---

    function toast(message, type = 'success') {
      const id = Date.now() + Math.random();
      toasts.value.push({ id, message, type });
      setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id); }, 4000);
    }

    // Exécute une action en empêchant le double clic, et affiche le résultat
    async function run(action, successMessage) {
      if (busy.value) return;
      busy.value = true;
      try {
        await action();
        if (successMessage) toast(successMessage);
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        busy.value = false;
      }
    }

    function formatDate(iso) {
      return new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function formatPrice(value) {
      return `${Number(value || 0).toFixed(2)} €`;
    }

    // Le serveur refuse déjà les autres liens ; on ne rend un <a> que pour du http(s)
    function isWebLink(link) {
      return /^https?:\/\//i.test(link || '');
    }

    // --- Session ---

    async function start(user) {
      me.value = user;
      tab.value = TABS[user.role][0].id;
      filter.value = 'active';
      search.value = '';
      await refresh();
    }

    async function refresh() {
      orders.value = await api.get('/orders');
      if (isAdmin.value) users.value = await api.get('/users');
    }

    async function login() {
      loginForm.error = '';
      try {
        const { token, user } = await api.post('/auth/login', { username: loginForm.username, password: loginForm.password });
        api.setToken(token);
        loginForm.username = loginForm.password = '';
        await start(user);
      } catch (err) {
        loginForm.error = err.message;
      }
    }

    function logout() {
      api.setToken(null);
      me.value = null;
      orders.value = [];
      users.value = [];
    }

    api.onSessionExpired = () => {
      logout();
      toast('Session expirée, reconnectez-vous.', 'error');
    };

    // --- Étudiant : demande de commande ---

    function addItem() {
      orderForm.items.push(emptyItem());
    }

    function removeItem(index) {
      if (orderForm.items.length > 1) orderForm.items.splice(index, 1);
    }

    function submitOrder() {
      return run(async () => {
        const order = await api.post('/orders', { title: orderForm.title, items: orderForm.items });
        orders.value.unshift(order);
        orderForm.title = '';
        orderForm.items = [emptyItem()];
        tab.value = 'orders';
      }, 'Demande envoyée.');
    }

    // --- Admin : commandes ---

    function setStatus(order, action) {
      if (action.confirm && !confirm(action.confirm)) return;
      return run(async () => {
        const updated = await api.patch(`/orders/${order.id}/status`, { status: action.to });
        Object.assign(order, updated);
      }, `Commande « ${order.title} » : ${STATUSES[action.to].label.toLowerCase()}.`);
    }

    // --- Admin : comptes ---

    function createAccount() {
      return run(async () => {
        const user = await api.post('/users', accountForm);
        users.value.push(user);
        Object.assign(accountForm, { username: '', name: '', password: '', role: 'student' });
      }, 'Compte créé.');
    }

    function renameAccount(user) {
      const name = prompt(`Nouveau nom pour ${user.username} :`, user.name);
      if (name === null) return;
      return run(async () => {
        Object.assign(user, await api.patch(`/users/${user.username}`, { name }));
      }, 'Nom modifié.');
    }

    function resetPassword(user) {
      const password = prompt(`Nouveau mot de passe pour ${user.username} (6 caractères minimum) :`);
      if (password === null) return;
      return run(() => api.patch(`/users/${user.username}`, { password }), `Mot de passe de ${user.username} réinitialisé.`);
    }

    function deleteAccount(user) {
      if (!confirm(`Supprimer le compte ${user.username} ? Ses commandes resteront dans l'historique.`)) return;
      return run(async () => {
        await api.delete(`/users/${user.username}`);
        users.value = users.value.filter(u => u.username !== user.username);
      }, 'Compte supprimé.');
    }

    // --- Tous : mot de passe ---

    function changePassword() {
      if (passwordForm.newPassword !== passwordForm.confirm) {
        toast('Les deux nouveaux mots de passe ne correspondent pas.', 'error');
        return;
      }
      return run(async () => {
        const { token } = await api.put('/auth/password', passwordForm);
        api.setToken(token);
        Object.assign(passwordForm, { oldPassword: '', newPassword: '', confirm: '' });
      }, 'Mot de passe modifié.');
    }

    onMounted(async () => {
      api.get('/status').then(s => { storage.value = s.storage; }).catch(() => {});
      if (!api.token) return;
      try {
        await start(await api.get('/auth/me'));
      } catch {
        logout();
      }
    });

    return {
      STATUSES, ACTIONS, FILTERS,
      me, storage, tab, tabs, orders, users, filter, search, busy, toasts,
      loginForm, orderForm, accountForm, passwordForm,
      isAdmin, orderTotal, counts, visibleOrders,
      formatDate, formatPrice, isWebLink,
      login, logout, addItem, removeItem, submitOrder, setStatus,
      createAccount, renameAccount, resetPassword, deleteAccount, changePassword
    };
  }
}).mount('#app');
