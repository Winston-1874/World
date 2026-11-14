const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

function lancer(socketPath) {
  const enfant = spawn(process.execPath, ['serveur/serveur.js'], { cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, AUTHORITATIVE: '1', PORT: '0', SOCKET_PATH: socketPath }, stdio: ['ignore', 'pipe', 'pipe'] });
  const fin = once(enfant, 'exit');
  let sortie = '';
  enfant.stdout.on('data', b => { sortie += b; }); enfant.stderr.on('data', b => { sortie += b; });
  return { enfant, fin, sortie: () => sortie, async fermer() { if (enfant.exitCode === null) enfant.kill(); await fin; } };
}
function requete(socketPath, upgrade = false) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path: upgrade ? '/ws' : '/', headers: upgrade ? {
      Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
    } : {} });
    req.on('error', reject);
    req.on('response', res => { let corps = ''; res.on('data', b => { corps += b; }); res.on('end', () => resolve({ code: res.statusCode, corps })); });
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve({ code: res.statusCode, accept: res.headers['sec-websocket-accept'] }); });
    req.end();
  });
}

test('socket Unix : HTTP, upgrade WebSocket et chemin déjà occupé préservé', { skip: process.platform === 'win32', timeout: 6000 }, async t => {
  const dossier = await fs.mkdtemp(path.join(os.tmpdir(), 'world-socket-'));
  const socketPath = path.join(dossier, 'http.sock'), a = lancer(socketPath);
  t.after(async () => { await a.fermer(); await fs.rm(dossier, { recursive: true, force: true }); });
  const fin = Date.now() + 3000;
  while (!a.sortie().includes('Socket Unix prêt')) {
    assert.equal(a.enfant.exitCode, null, a.sortie());
    if (Date.now() > fin) throw Error('Socket non disponible : ' + a.sortie());
    await new Promise(r => setTimeout(r, 20));
  }
  const inode = await fs.lstat(socketPath); assert.ok(inode.isSocket());
  const page = await requete(socketPath); assert.equal(page.code, 200); assert.match(page.corps, /<html/);
  const ws = await requete(socketPath, true); assert.equal(ws.code, 101); assert.equal(ws.accept, 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  const b = lancer(socketPath); t.after(() => b.fermer());
  assert.equal((await b.fin)[0], 1); assert.match(b.sortie(), /existant/);
  assert.equal((await fs.lstat(socketPath)).ino, inode.ino);
  assert.equal((await requete(socketPath)).code, 200);
});

test('socket Unix : fichier existant et chemin relatif refusés sans effacement', { skip: process.platform === 'win32', timeout: 6000 }, async t => {
  const dossier = await fs.mkdtemp(path.join(os.tmpdir(), 'world-socket-'));
  t.after(() => fs.rm(dossier, { recursive: true, force: true }));
  const fichier = path.join(dossier, 'garder'); await fs.writeFile(fichier, 'préserver');
  for (const chemin of [fichier, 'relatif.sock']) {
    const p = lancer(chemin); t.after(() => p.fermer());
    assert.equal((await p.fin)[0], 1); assert.match(p.sortie(), /SOCKET_PATH/);
  }
  assert.equal(await fs.readFile(fichier, 'utf8'), 'préserver');
});
