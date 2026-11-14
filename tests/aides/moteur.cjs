const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');

// Banc de mesure seulement : ce contexte VM n'est pas une isolation de sécurité.
// Les règles sont chargées depuis les vrais scripts du client, dans leur ordre HTML.
function creerMoteur(options = {}) {
  const muet = () => {};
  const contexte = vm.createContext({
    console,
    localStorage: { getItem: () => options.langue || 'en' },
    document: { documentElement: { classList: { add: muet } }, addEventListener: muet },
    UI: { log: muet, showEnd: muet, askAlliance: () => true },
    Render: { markDirty: muet, floatText: muet, towerShot: muet },
    Music: { sound: muet },
  });
  const racine = path.resolve(__dirname, '../..');
  const exclus = new Set(['js/icons.js', 'js/music.js', 'js/render.js', 'js/net.js', 'js/main.js']);
  const html = fs.readFileSync(path.join(racine, 'index.html'), 'utf8');
  for (const [, script] of html.matchAll(/<script src="(js\/[^"?]+\.js)"><\/script>/g)) {
    if (exclus.has(script)) continue;
    vm.runInContext(fs.readFileSync(path.join(racine, script), 'utf8'), contexte, { filename: script });
  }
  const { Game, Replay } = vm.runInContext('({ Game, Replay })', contexte);
  Game.init({ online: true, seed: 123456, mapType: 'normal', mapSize: 'petit', difficulty: 'normal',
    humans: [{ name: 'Premier', banner: 0 }, { name: 'Second', banner: 1 }], opponents: 4,
    pacts: true, ...options });
  return { Game, Replay };
}

// Contrôle complet des données propres du moteur, caches inclus, sans se limiter
// à une case sur sept comme stateHash. Les tableaux sont hachés sans copie JSON.
function empreinteEtat(game) {
  const hash = createHash('sha256'), vus = new Map();
  function visiter(v) {
    if (v === null || typeof v !== 'object') {
      if (typeof v === 'function') throw new Error('Fonction inattendue dans les données');
      hash.update(typeof v + ':' + String(v) + ';'); return;
    }
    if (vus.has(v)) { hash.update('ref:' + vus.get(v) + ';'); return; }
    vus.set(v, vus.size);
    const type = Object.prototype.toString.call(v);
    hash.update(type + ':');
    if (ArrayBuffer.isView(v)) {
      hash.update(String(v.byteLength) + ':');
      hash.update(Buffer.from(v.buffer, v.byteOffset, v.byteLength));
    } else if (type === '[object ArrayBuffer]') {
      hash.update(String(v.byteLength) + ':'); hash.update(Buffer.from(v));
    } else if (type === '[object Map]') {
      for (const [k, valeur] of v) { visiter(k); visiter(valeur); }
    } else if (type === '[object Set]') {
      for (const valeur of v) visiter(valeur);
    } else {
      for (const k of Object.keys(v).sort()) {
        if (v === game && k === 'rand') continue; // fermeture privée, vérifiée par la trajectoire des tours suivants
        hash.update(JSON.stringify(k) + ':'); visiter(v[k]);
      }
    }
    hash.update(';fin;');
  }
  visiter(game);
  return hash.digest('hex');
}

module.exports = { creerMoteur, empreinteEtat };
