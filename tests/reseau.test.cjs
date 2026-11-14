const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');

class Client {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.messages = [];
    this.attentes = [];
    this.ws.addEventListener('message', e => {
      const m = JSON.parse(e.data);
      const at = this.attentes.findIndex(a => a.test(m));
      if (at < 0) this.messages.push(m);
      else { const [a] = this.attentes.splice(at, 1); clearTimeout(a.timer); a.resolve(m); }
    });
  }
  envoyer(m) { this.ws.send(JSON.stringify(m)); }
  attendre(test) {
    const at = this.messages.findIndex(test);
    if (at >= 0) return Promise.resolve(this.messages.splice(at, 1)[0]);
    return new Promise((resolve, reject) => {
      const a = { test, resolve };
      a.timer = setTimeout(() => { this.attentes = this.attentes.filter(x => x !== a); reject(new Error('Message attendu absent')); }, 5000);
      this.attentes.push(a);
    });
  }
  fermer() {
    this.ws.close();
    for (const a of this.attentes) clearTimeout(a.timer);
  }
}

test('16 clients reçoivent les mêmes ordres ; un autre salon reste isolé', { timeout: 15000 }, async t => {
  const enfant = spawn(process.execPath, ['serveur/serveur.js'], {
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, PORT: '0', HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => { if (enfant.exitCode === null) { const fini = once(enfant, 'exit'); enfant.kill(); await fini; } });
  const url = await new Promise((resolve, reject) => {
    let sortie = '', erreur = '';
    const timer = setTimeout(() => reject(new Error('Démarrage trop long : ' + erreur)), 5000);
    enfant.stderr.on('data', b => { erreur += b; });
    enfant.once('error', e => { clearTimeout(timer); reject(e); });
    enfant.once('exit', () => { clearTimeout(timer); reject(new Error('Serveur arrêté : ' + erreur)); });
    enfant.stdout.on('data', b => {
      sortie += b;
      const trouve = sortie.match(/ws:\/\/127\.0\.0\.1:\d+\/ws/);
      if (trouve) { clearTimeout(timer); resolve(trouve[0]); }
    });
  });
  const clients = [];
  t.after(() => clients.forEach(c => c.fermer()));
  for (let i = 0; i < 17; i++) {
    const c = new Client(url); clients.push(c);
    await once(c.ws, 'open');
    c.envoyer({ t: 'hello', protocol: 1, name: 'Royaume ' + i, banner: i });
  }
  const [hote] = clients;
  hote.envoyer({ t: 'create', settings: { opponents: 0 } });
  const salon = await hote.attendre(m => m.t === 'room');
  for (const c of clients.slice(1, 16)) c.envoyer({ t: 'join', code: salon.code });
  await hote.attendre(m => m.t === 'room' && m.players.length === 16);
  const autre = clients[16];
  autre.envoyer({ t: 'join', code: salon.code });
  assert.equal((await autre.attendre(m => m.t === 'error')).code, 'full');
  autre.envoyer({ t: 'create', settings: { opponents: 0 } });
  const autreSalon = await autre.attendre(m => m.t === 'room');
  assert.notEqual(autreSalon.code, salon.code);
  hote.envoyer({ t: 'start' }); autre.envoyer({ t: 'start' });
  const departs = await Promise.all(clients.map(c => c.attendre(m => m.t === 'start')));
  assert.equal(new Set(departs.slice(0, 16).map(m => m.me)).size, 16);
  assert.ok(departs.slice(0, 16).every(m => m.seed === departs[0].seed && m.players.length === 16));
  assert.equal(departs[16].players.length, 1);
  hote.envoyer({ t: 'order', s: 12, o: { k: 'spawn', i: 123 }, slot: 9 });
  const tours = await Promise.all(clients.slice(0, 16).map(c => c.attendre(m => m.t === 'turn' && m.o.some(o => o[2] === 12))));
  for (const tour of tours) assert.deepEqual(tour, tours[0]);
  assert.equal(tours[0].o[0][0], departs[0].me, 'la place vient du serveur, pas du client');
  const tourAutre = await autre.attendre(m => m.t === 'turn' && m.n >= tours[0].n);
  assert.deepEqual(tourAutre.o, []);
  const sortant = departs[1].me;
  clients[1].fermer();
  const depart = await hote.attendre(m => m.t === 'turn' && m.o.some(o => o[0] === sortant && o[1].k === 'leave'));
  assert.equal(depart.o.filter(o => o[1].k === 'leave').length, 1);
});
