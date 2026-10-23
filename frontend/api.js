// Client de l'API REST.
// Le jeton de session est gardé dans sessionStorage et envoyé à chaque requête :
// c'est le serveur qui vérifie l'identité et le rôle, jamais le navigateur.
const api = {
  token: sessionStorage.getItem('token'),
  onSessionExpired: null,

  setToken(token) {
    this.token = token;
    if (token) sessionStorage.setItem('token', token);
    else sessionStorage.removeItem('token');
  },

  async request(method, url, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const res = await fetch(`/api${url}`, { method, headers, body: body && JSON.stringify(body) });
    const data = res.status === 204 ? null : await res.json().catch(() => ({}));

    if (res.status === 401 && this.token) this.onSessionExpired?.();
    if (!res.ok) throw new Error(data?.error || `Erreur ${res.status}`);
    return data;
  },

  get(url) { return this.request('GET', url); },
  post(url, body) { return this.request('POST', url, body); },
  put(url, body) { return this.request('PUT', url, body); },
  patch(url, body) { return this.request('PATCH', url, body); },
  delete(url) { return this.request('DELETE', url); }
};
