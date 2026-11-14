const { test } = require('node:test');
const assert = require('node:assert/strict');
const Etat = require('../js/etat.js');
const { creerMoteur } = require('./aides/moteur.cjs');

test('état binaire complet puis différences : reconstruction exacte des règles publiées', () => {
  const { Game } = creerMoteur();
  let precedent = Etat.capturer(Game);
  let client = Etat.appliquer(Etat.encoder(precedent, null, { game: 'test', seq: 1, turn: 0 }));
  Game.beginOnline();
  for (let n = 2; n <= 12; n++) {
    Game.update();
    const actuel = Etat.capturer(Game);
    client = Etat.appliquer(Etat.encoder(actuel, precedent, { game: 'test', seq: n, base: n - 1, turn: Game.tick }), client);
    const complet = Etat.appliquer(Etat.encoder(actuel, null, { game: 'test', seq: n, turn: Game.tick }));
    assert.deepEqual(client.data, complet.data);
    precedent = actuel;
  }
  assert.ok(client.data.works instanceof Map);
  assert.ok(client.data.fortMines instanceof Set);
  assert.ok(client.data.owner instanceof Int16Array);
  assert.equal(client.data.players[0].gold, Game.players[0].gold);
});

test('une mauvaise base ou un paquet tronqué ne modifie pas le client', () => {
  const { Game } = creerMoteur(), a = Etat.capturer(Game);
  const client = Etat.appliquer(Etat.encoder(a, null, { game: 'a', seq: 1, turn: 0 }));
  const avant = client.data.owner.slice();
  Game.owner[1] = 5;
  const b = Etat.capturer(Game);
  assert.throws(() => Etat.appliquer(Etat.encoder(b, a, { game: 'a', seq: 3, base: 2, turn: 1 }), client), /base/i);
  const paquet = Etat.encoder(b, a, { game: 'a', seq: 2, base: 1, turn: 1 });
  assert.throws(() => Etat.appliquer(paquet.subarray(0, paquet.length - 1), client));
  assert.deepEqual(client.data.owner, avant);
});

test('les mutations d’affichage ne contaminent pas la base réseau', () => {
  const { Game } = creerMoteur(), a = Etat.capturer(Game);
  const client = Etat.appliquer(Etat.encoder(a, null, { game: 'a', seq: 1, turn: 0 }));
  client.data.owner[1] = 42; client.data.players[0].gold = 999;
  const suivant = Etat.appliquer(Etat.encoder(a, a, { game: 'a', seq: 2, base: 1, turn: 0 }), client);
  assert.equal(suivant.data.owner[1], Game.owner[1]);
  assert.equal(suivant.data.players[0].gold, Game.players[0].gold);
});

test('un tableau annoncé sans son contenu complet est refusé', () => {
  const { Game } = creerMoteur();
  const packet = Etat.encoder(Etat.capturer(Game), null, { game: 'a', seq: 1, turn: 0 });
  const n = new DataView(packet.buffer).getUint32(0, true);
  const h = JSON.parse(new TextDecoder().decode(packet.subarray(4, 4 + n)));
  h.patches = [];
  const head = new TextEncoder().encode(JSON.stringify(h)), tronque = new Uint8Array(4 + head.length);
  new DataView(tronque.buffer).setUint32(0, head.length, true); tronque.set(head, 4);
  assert.throws(() => Etat.appliquer(tronque), /incomplet/);
});
