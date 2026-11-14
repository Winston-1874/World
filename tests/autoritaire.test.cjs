const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { serveur, Client } = require('./aides/reseau-autoritaire.cjs');
const { creerAutoritaire } = require('../serveur/autoritaire.cjs');

async function attendre(test, limite = 12000) {
  const fin = Date.now() + limite;
  while (!test()) { if (Date.now() > fin) throw Error('Condition absente'); await new Promise(r => setTimeout(r, 25)); }
}

test('états identiques, commandes confirmées, reprise et absence de double exécution', { timeout: 30000 }, async t => {
  const s = await serveur(); t.after(() => s.close());
  const a = await new Client(s.url).open('fr'), b = await new Client(s.url).open();
  t.after(() => { a.close(); b.close(); });
  a.send({ t: 'create', settings: { mapSize: 'petit', opponents: 4, pacts: true } });
  const room = await a.message('room');
  b.send({ t: 'join', code: room.code }); await b.message('room');
  a.send({ t: 'start' });
  await Promise.all([a.wait(c => c.state?.data.phase === 'playing'), b.wait(c => c.state?.data.phase === 'playing')]);
  a.send({ t: 'order', s: 1, o: { k: 'ally', to: 1 } });
  await b.wait(c => c.state.data.allianceRequests.size === 1);
  b.send({ t: 'order', s: 1, o: { k: 'allyAnswer', from: 0, yes: true } });
  await a.wait(c => c.state.data.players[0].pact >= 0);
  a.send({ t: 'pause', on: true });
  await Promise.all([a.wait(c => c.state.data.paused), b.wait(c => c.state.data.paused)]);
  await b.wait(c => c.state.seq === a.state.seq);
  assert.deepEqual(a.state.data, b.state.data);
  const ticket = b.start; const closed = once(b.ws, 'close'); b.close(); await closed;
  const c = await new Client(s.url).open(); t.after(() => c.close());
  c.send({ t: 'resume', code: ticket.code, token: ticket.token });
  await c.wait(c => c.state);
  assert.equal(c.start.me, 1);
  assert.equal(c.state.data.players[1].human, true);
  c.send({ t: 'order', s: 1, o: { k: 'gold', to: 0, g: 100 } }); // s=1 déjà confirmé
  a.send({ t: 'pause', on: false });
  await c.wait(c => c.state.data.tick > b.state.data.tick + 2);
  assert.equal(c.state.results.filter(r => r.slot === 1 && r.s === 1).length, 1);
  assert.equal(c.state.results.find(r => r.slot === 1 && r.s === 1).result, null);
});

test('un client lent ne bloque pas la partie et son royaume devient bot après expiration', { timeout: 25000 }, async t => {
  const s = await serveur({ RECONNECT_SECONDS: '1' }); t.after(() => s.close());
  const a = await new Client(s.url).open(), b = await new Client(s.url).open();
  t.after(() => { a.close(); b.close(); });
  a.send({ t: 'create', settings: { mapSize: 'petit', opponents: 4 } });
  const room = await a.message('room'); b.send({ t: 'join', code: room.code }); await b.message('room');
  b.ack = false; const closed = once(b.ws, 'close');
  a.send({ t: 'start' });
  await a.wait(c => c.state?.data.tick >= 10);
  const debut = a.state.data.tick;
  await closed;
  await a.wait(c => !c.state.data.players[1].human);
  assert.ok(a.state.data.tick > debut);
  const c = await new Client(s.url).open(); t.after(() => c.close());
  c.send({ t: 'resume', code: b.start.code, token: b.start.token });
  assert.equal((await c.message('error')).code, 'expired');
});

test('deux processus indépendants : admission bornée et un arrêt ne détruit pas l’autre partie', { timeout: 20000 }, async t => {
  const messages = [];
  const api = creerAutoritaire({ send: (c, m) => messages.push({ c: c.id, ...m }), sendFrame() {}, closeConn() {},
    cleanSettings: s => ({ mapType: 'normal', mapSize: 'petit', opponents: 4, difficulty: 'normal', pacts: true, ...s }),
    limite: (nom, defaut) => ({ AUTH_SPAWN_SECONDS: 1, MAX_ACTIVE_GAMES: 2 }[nom] ?? defaut) });
  t.after(() => api.fermer());
  const clients = [1, 2, 3].map(id => ({ id }));
  for (const c of clients) {
    api.onMessage(c, { t: 'hello', protocol: 2, name: 'Test', banner: 0 });
    api.onMessage(c, { t: 'create' }); api.onMessage(c, { t: 'start' });
  }
  assert.ok(messages.some(m => m.c === 3 && m.code === 'capacity'));
  const g1 = clients[0].authRoom.game, g2 = clients[1].authRoom.game;
  assert.notEqual(g1.child.pid, g2.child.pid);
  await attendre(() => g1.current && g2.current);
  const seq = g2.current.seq;
  g1.child.kill('SIGKILL');
  await attendre(() => g1.stopped && g2.current.seq > seq + 2);
  assert.equal(api.metrics().active, 1);
});

test('une coupure pendant la génération conserve un jeton de reprise', { timeout: 15000 }, async t => {
  const s = await serveur(); t.after(() => s.close());
  const a = await new Client(s.url).open(); t.after(() => a.close());
  a.send({ t: 'create', settings: { mapSize: 'petit', opponents: 4 } }); await a.message('room'); a.send({ t: 'start' });
  const ticket = await a.message('start'), closed = once(a.ws, 'close'); a.close(); await closed;
  const b = await new Client(s.url).open(); t.after(() => b.close());
  b.send({ t: 'resume', code: ticket.code, token: ticket.token });
  await b.wait(c => c.state?.data.phase === 'playing');
  assert.equal(b.start.me, 0);
});

test('une demande de reprise croisant un ancien acquittement conserve la connexion', { timeout: 15000 }, async t => {
  const s = await serveur(); t.after(() => s.close());
  const a = await new Client(s.url).open(); t.after(() => a.close());
  a.send({ t: 'create', settings: { mapSize: 'petit', opponents: 2 } }); await a.message('room');
  a.ack = false; a.send({ t: 'start' });
  await a.wait(c => c.transfer);
  const ancien = a.transfer.transfer, seq = a.transfer.seq;
  a.send({ t: 'resync' });
  a.send({ t: 'stateAck', transfer: ancien, index: 0 });
  a.ack = true;
  await a.wait(c => c.state?.seq > seq);
  assert.equal(a.ws.readyState, WebSocket.OPEN);
});

test('les complets sont produits à la demande et partagés entre les reprises', { timeout: 12000 }, async t => {
  const s = await serveur(); t.after(() => s.close());
  const a = await new Client(s.url).open(), b = await new Client(s.url).open();
  t.after(() => { a.close(); b.close(); });
  const metrics = () => fetch(s.url.replace('ws:', 'http:').replace('/ws', '/metrics')).then(r => r.json()).then(m => m.parties[0]);
  a.send({ t: 'create', settings: { mapSize: 'petit', opponents: 2 } });
  const room = await a.message('room'); b.send({ t: 'join', code: room.code }); await b.message('room');
  a.send({ t: 'start' });
  await a.wait(c => c.state?.seq >= 5);
  const avant = await metrics();
  assert.equal(avant.complets, 1, 'aucun complet supplémentaire pour des clients à jour');
  const seq = a.state.seq;
  a.send({ t: 'resync' }); b.send({ t: 'resync' });
  await Promise.all([a.wait(c => c.state.seq > seq), b.wait(c => c.state?.seq > seq)]);
  assert.equal((await metrics()).complets, 2, 'un seul complet pour les deux clients');
  await b.wait(c => c.state.seq === a.state.seq);
  assert.deepEqual(a.state.data, b.state.data);
});
