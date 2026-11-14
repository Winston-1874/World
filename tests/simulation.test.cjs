const { test } = require('node:test');
const assert = require('node:assert/strict');
const { creerSimulation } = require('../serveur/simulation.cjs');

test('ordres autoritaires : indices, alliance non sollicitée, duplication et langue', () => {
  const s = creerSimulation({ pacts: true });
  s.Game.beginOnline();
  const avant = s.Game.players[0].gold;
  assert.equal(s.commande(0, 1, { k: 'gold', to: 45, g: 10 }, 'fr').code, 'invalid');
  assert.equal(s.Game.players[0].gold, avant);
  assert.equal(s.commande(1, 1, { k: 'allyAnswer', from: 0, yes: true }).code, 'request');
  assert.equal(s.commande(0, 2, { k: 'ally', to: 1 }).result, 'pending');
  assert.equal(s.Game.allianceRequests.size, 1);
  s.commande(1, 2, { k: 'allyAnswer', from: 0, yes: true });
  assert.equal(s.Game.areAllied(0, 1), true);
  const or = s.Game.players[0].gold;
  s.commande(0, 3, { k: 'gold', to: 1, g: 10 });
  s.commande(0, 3, { k: 'gold', to: 1, g: 10 });
  assert.equal(s.Game.players[0].gold, or - 10);
  assert.equal(s.commande(0, 4, { k: 'begin' }).code, 'invalid');
});
