const { test } = require('node:test');
const assert = require('node:assert/strict');
const { creerMoteur, empreinteEtat } = require('./aides/moteur.cjs');

test('deux contextes gardent le même état complet avec bots et ordres', () => {
  const a = creerMoteur(), b = creerMoteur();
  assert.equal(empreinteEtat(a.Game), empreinteEtat(b.Game));
  for (const { Game } of [a, b]) Game.runOrder(0, { k: 'begin' });
  for (let n = 0; n < 300; n++) {
    for (const { Game } of [a, b]) {
      if (n === 20) Game.runOrder(0, { k: 'ally', to: 1 });
      if (n === 21) Game.runOrder(1, { k: 'allyAnswer', from: 0, yes: true });
      if (n === 40) Game.runOrder(0, { k: 'gold', to: 1, g: 25 });
      if (n === 100) Game.runOrder(1, { k: 'leave' });
      Game.update();
    }
    if (n % 50 === 0) assert.equal(empreinteEtat(a.Game), empreinteEtat(b.Game), `tour ${n}`);
  }
  assert.equal(a.Game.tick, 300);
  assert.ok(a.Replay.rec.frames.length > 0, 'le replay est réellement calculé');
  assert.equal(a.Game.players[1].human, false);
  assert.equal(empreinteEtat(a.Game), empreinteEtat(b.Game));
});

test('deux parties ne partagent ni carte ni royaumes ni replay', () => {
  const a = creerMoteur(), b = creerMoteur();
  const avant = empreinteEtat(b.Game);
  a.Game.runOrder(0, { k: 'begin' }); a.Game.update();
  assert.equal(empreinteEtat(b.Game), avant);
  assert.equal(b.Replay.rec, null);
  assert.notEqual(a.Game.owner, b.Game.owner);
});

test('le contrôle complet détecte une case ignorée par stateHash', () => {
  const { Game } = creerMoteur();
  const partielle = Game.stateHash(), complete = empreinteEtat(Game);
  Game.owner[1] = Game.owner[1] === 0 ? 1 : 0;
  assert.equal(Game.stateHash(), partielle);
  assert.notEqual(empreinteEtat(Game), complete);
});

test('deux points de vue et deux langues conservent les cartes et économies identiques', () => {
  const a = creerMoteur({ me: 0, langue: 'fr' }).Game;
  const b = creerMoteur({ me: 1, langue: 'en' }).Game;
  for (const g of [a, b]) g.runOrder(0, { k: 'begin' });
  for (let n = 0; n < 300; n++) { a.update(); b.update(); }
  // isHuman, human, les avertissements et certains caches dépendent légitimement du point de vue.
  for (const cle of ['terrain', 'owner', 'building', 'level', 'garrison', 'anchor', 'builtBy', 'wallAt', 'bridgeAt']) {
    assert.deepEqual(Buffer.from(a[cle].buffer), Buffer.from(b[cle].buffer), cle);
  }
  const economies = g => Array.from(g.players, p => ({ id: p.id, human: p.human,
    gold: p.gold, troops: p.troops, tiles: p.tiles, pact: p.pact, alive: p.alive, glory: p.glory }));
  assert.deepEqual(economies(a), economies(b));
});
