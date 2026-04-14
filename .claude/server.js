const http = require('http');
const fs = require('fs');
const path = require('path');
const mime = {
  'html': 'text/html; charset=utf-8',
  'css': 'text/css; charset=utf-8',
  'js': 'application/javascript; charset=utf-8',
  'json': 'application/json; charset=utf-8',
  'png': 'image/png',
  'jpg': 'image/jpeg'
};
const root = path.resolve(__dirname, '..');
http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/') url = '/index.html';
  const fp = path.join(root, url);
  const ext = path.extname(fp).slice(1);
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); }
    else { res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain; charset=utf-8' }); res.end(data); }
  });
}).listen(8080, () => console.log('Server running on 8080'));
