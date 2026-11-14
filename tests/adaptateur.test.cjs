const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('une décompression achevée après remplacement du socket est abandonnée', async () => {
  let liberer, entre, installations = 0, envois = 0;
  const attente = new Promise(r => { liberer = r; });
  const entree = new Promise(r => { entre = r; });
  const ws = {}, Net = { ws, send: () => envois++ };
  const contexte = vm.createContext({ URLSearchParams, location: { search: '' }, Net, Blob, Uint8Array, performance,
    Etat: { MAX: 100 },
    DecompressionStream: class {
      constructor() { return new TransformStream({ async transform(b, controle) { entre(); await attente; controle.enqueue(b); } }); }
    },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../js/net-authoritative.js'), 'utf8'), contexte);
  const A = vm.runInContext('Autoritaire', contexte);
  A.installer = () => installations++;
  A.transfer = { id: 1, index: 0, offset: 0, bytes: new Uint8Array(2) };
  const traitement = A.message(new Uint8Array([1, 2]).buffer, ws);
  await entree; Net.ws = {}; liberer(); await traitement;
  assert.equal(installations, 0); assert.equal(envois, 0);
});
