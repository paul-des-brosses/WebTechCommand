// Serveur local pour développer, sans dépendance : il fait en local ce que GitHub Pages fait en ligne.
// (Ouvrir index.html par double-clic ne marche pas : le navigateur bloque les modules JavaScript en file://.)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);

  // Pas de sortie du dossier, pas de fichiers cachés (.git…)
  if (!file.startsWith(ROOT + path.sep) || urlPath.split('/').some(part => part.startsWith('.'))) {
    res.writeHead(404).end('Introuvable');
    return;
  }
  fs.readFile(file, (err, content) => {
    if (err) {
      res.writeHead(404).end('Introuvable');
      return;
    }
    res.writeHead(200, { 'Content-Type': `${TYPES[path.extname(file)] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-store' });
    res.end(content);
  });
}).listen(PORT, () => console.log(`Site disponible sur http://localhost:${PORT}`));
