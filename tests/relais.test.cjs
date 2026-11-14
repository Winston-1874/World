const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const charger = require('node:module').createRequire(path.resolve(__dirname, '../serveur/serveur.js'));

// Exécuter le vrai relais sans ouvrir de port ni lancer de minuterie.
function relais(env = {}) {
  const serveur = new EventEmitter();
  serveur.listen = (...args) => { serveur.ecoute = args; };
  const timers = [];
  const contexte = vm.createContext({
    require: nom => nom === 'http' ? { createServer: () => serveur } : charger(nom),
    __dirname: path.resolve(__dirname, '../serveur'), Buffer, URL,
    process: { env }, console: { log() {}, error() {} },
    setInterval: fn => timers.push(fn),
  });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../serveur/serveur.js'), 'utf8'), contexte);
  const api = vm.runInContext('({ onMessage, readFrames, sendFrame, rooms, conns })', contexte);
  function connecter(head = Buffer.alloc(0)) {
    const socket = new EventEmitter();
    Object.assign(socket, { destroyed: false, writableLength: 0, sorties: [],
      setNoDelay() {}, write(b) { this.sorties.push(b); return true; },
      end() { this.destroy(); }, destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('close'); } },
    });
    serveur.emit('upgrade', { url: '/ws', headers: { upgrade: 'websocket', connection: 'Upgrade',
      'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' } }, socket, head);
    return { socket, conn: [...api.conns].find(c => c.socket === socket) };
  }
  function joueur() {
    const { conn } = connecter();
    api.onMessage(conn, { t: 'hello', protocol: 1, name: 'Test', banner: 0 });
    return conn;
  }
  return { ...api, connecter, joueur, serveur, timers };
}

function trame(data, op = 1, fin = true) {
  data = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const entete = data.length < 126 ? Buffer.from([(fin ? 128 : 0) | op, 128 | data.length])
    : Buffer.from([(fin ? 128 : 0) | op, 254, data.length >> 8, data.length & 255]);
  return Buffer.concat([entete, Buffer.alloc(4), data]);
}

test('un message fragmenté valide tolère un ping intercalé', () => {
  const r = relais(), { conn, socket } = r.connecter();
  socket.emit('data', trame('{"t":"hel', 1, false));
  socket.emit('data', trame('p', 9));
  socket.emit('data', trame('lo","protocol":1}', 0));
  assert.equal(conn.hello, true);
  assert.equal(socket.destroyed, false);
});

test('les essais peuvent demander un port libre et une écoute locale', () => {
  const r = relais({ PORT: '0', HOST: '127.0.0.1' });
  assert.equal(r.serveur.ecoute[0], 0);
  assert.equal(r.serveur.ecoute[1], '127.0.0.1');
});

test('les fragments cumulés ne dépassent pas la limite du message', () => {
  const r = relais({ MAX_MESSAGE_BYTES: '1024' }), { socket } = r.connecter();
  socket.emit('data', trame('a'.repeat(600), 1, false));
  socket.emit('data', trame('a'.repeat(600), 0, false));
  assert.equal(socket.destroyed, true);
});

for (const [nom, frame] of [
  ['continuation sans début', trame('{}', 0)],
  ['ping fragmenté', trame('p', 9, false)],
  ['binaire non accepté', trame('{}', 2)],
  ['texte UTF-8 invalide', trame(Buffer.from([0xc0, 0xaf]))],
  ['bit réservé', Buffer.from([0xc1, 0x82, 0, 0, 0, 0, 123, 125])],
]) test(`fermeture pour ${nom}`, () => {
  const { socket } = relais().connecter();
  socket.emit('data', frame);
  assert.equal(socket.destroyed, true);
});

test('le premier message livré avec upgrade est traité', () => {
  const { conn } = relais().connecter(trame('{"t":"hello","protocol":1}'));
  assert.equal(conn.hello, true);
});

test('un client lent est retiré avant de grossir sa file de sortie', () => {
  const r = relais({ MAX_PENDING_BYTES: '1024' }), { conn, socket } = r.connecter();
  socket.writableLength = 1020;
  const avant = socket.sorties.length;
  r.sendFrame(conn, 1, Buffer.alloc(20));
  assert.equal(socket.destroyed, true);
  assert.equal(socket.sorties.length, avant);
});

test('le nombre de connexions est borné', () => {
  const r = relais({ MAX_CONNECTIONS: '2' });
  r.connecter(); r.connecter();
  const { socket } = r.connecter();
  assert.equal(r.conns.size, 2);
  assert.equal(socket.destroyed, true);
});

test('le nombre de salons est borné, salon public compris', () => {
  const r = relais({ MAX_ROOMS: '2' }), a = r.joueur(), b = r.joueur();
  r.onMessage(a, { t: 'create' });
  r.onMessage(b, { t: 'create' });
  assert.equal(r.rooms.size, 2);
  assert.equal(b.room, null);
});

test('rejoindre son propre salon ne le retire pas du registre', () => {
  const r = relais(), a = r.joueur();
  r.onMessage(a, { t: 'create' });
  const room = a.room;
  r.onMessage(a, { t: 'join', code: room.code });
  assert.equal(r.rooms.get(room.code), room);
  assert.equal(room.members.length, 1);
});

test('un salon inaccessible ne fait pas quitter le salon actuel', () => {
  const r = relais(), a = r.joueur(), b = r.joueur();
  r.onMessage(a, { t: 'create' }); r.onMessage(b, { t: 'create' });
  const ancien = a.room;
  r.onMessage(b, { t: 'start' });
  r.onMessage(a, { t: 'join', code: b.room.code });
  assert.equal(a.room, ancien);
});

test('les empreintes futures et trop anciennes ne remplissent pas la mémoire', () => {
  const r = relais(), a = r.joueur();
  r.onMessage(a, { t: 'create' }); r.onMessage(a, { t: 'start' });
  a.room.game.turn = 5000;
  for (let n = 0; n < 3000; n++) r.onMessage(a, { t: 'hash', n, h: 3 });
  for (let n = 6000; n < 9000; n++) r.onMessage(a, { t: 'hash', n, h: 3 });
  assert.equal(a.room.game.hashes.size, 0);
  r.onMessage(a, { t: 'hash', n: 5000, h: 3 });
  assert.equal(a.room.game.hashes.size, 1);
});

test('les ordres réservés et inconnus ne sont pas relayés', () => {
  const r = relais(), a = r.joueur();
  r.onMessage(a, { t: 'create' }); r.onMessage(a, { t: 'start' });
  for (const k of ['begin', 'leave', 'continue', 'hyChoice', 'inconnu'])
    r.onMessage(a, { t: 'order', s: 1, o: { k } });
  assert.equal(a.room.game.queue.length, 0);
});

test('un ordre mal typé ne peut pas empoisonner les calculs du navigateur', () => {
  const r = relais(), a = r.joueur();
  r.onMessage(a, { t: 'create' }); r.onMessage(a, { t: 'start' });
  for (const o of [{ k: 'spawn', i: {} }, { k: 'gold', to: 0, g: -100 },
    { k: 'attack', target: 0, troops: '100' }]) r.onMessage(a, { t: 'order', s: 1, o });
  assert.equal(a.room.game.queue.length, 0);
  r.onMessage(a, { t: 'order', s: 2, o: { k: 'spawn', i: 125 } });
  assert.equal(a.room.game.queue.length, 1);
});

test('les ordres valides gardent leurs sentinelles et leurs montants fractionnaires', () => {
  const r = relais(), a = r.joueur();
  r.onMessage(a, { t: 'create' }); r.onMessage(a, { t: 'start' });
  const ordres = [
    { k: 'attack', target: -1, troops: 12.5, aim: 15, src: -1 },
    { k: 'wall', c: 23, i: 24, from: -1 },
    { k: 'gold', to: 1, g: 20.5 }, { k: 'allyAnswer', from: 1, yes: false },
    { k: 'build', i: 25, type: 8 }, { k: 'relicChase', run: 12, troops: 30 },
  ];
  ordres.forEach((o, s) => r.onMessage(a, { t: 'order', s, o }));
  assert.equal(a.room.game.queue.length, ordres.length);
  assert.equal(JSON.stringify(a.room.game.queue.map(q => q[1])), JSON.stringify(ordres));
});

test('les fragments vides et les rafales de ping restent bornés', () => {
  for (const vide of [true, false]) {
    const { socket } = relais().connecter();
    for (let i = 0; i < 300 && !socket.destroyed; i++)
      socket.emit('data', trame('', vide ? (i === 0 ? 1 : 0) : 9, !vide));
    assert.equal(socket.destroyed, true);
  }
});

test('une trame incomplète expire même si le client répond aux pings', () => {
  const r = relais(), { conn, socket } = r.connecter();
  socket.emit('data', Buffer.from([0x81]));
  conn.incompleteSince = Date.now() - 31000;
  conn.alive = true;
  r.timers[0]();
  assert.equal(socket.destroyed, true);
});

test('une annonce de longueur 64 bits excessive ferme sans allouer le corps', () => {
  const { socket } = relais().connecter();
  socket.emit('data', Buffer.from([0x81, 0xff, 0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]));
  assert.equal(socket.destroyed, true);
});

test('une limite invalide fait échouer le démarrage', () => {
  assert.throws(() => relais({ MAX_ROOMS: 'Infinity' }), /Réglage invalide/);
  assert.throws(() => relais({ MAX_PENDING_BYTES: '0' }), /Réglage invalide/);
});

test('le délai du message suivant repart après un message complet', () => {
  const r = relais(), { conn, socket } = r.connecter();
  socket.emit('data', trame('{"t":', 1, false));
  conn.incompleteSince = Date.now() - 31000;
  socket.emit('data', Buffer.concat([trame('"hello","protocol":1}', 0), Buffer.from([0x81])]));
  r.timers[0]();
  assert.equal(conn.hello, true);
  assert.equal(socket.destroyed, false);
});

test('un départ public à capacité maximale attend sans créer de salon supplémentaire', () => {
  const r = relais({ MAX_ROOMS: '2' }), a = r.joueur(), b = r.joueur();
  r.onMessage(a, { t: 'create' }); r.onMessage(b, { t: 'public' });
  b.room.startsAt = 0;
  r.timers[1]();
  assert.equal(r.rooms.size, 2);
  assert.equal(b.room.game, null);
  assert.ok(b.room.startsAt > Date.now());
});
