const { creerMoteur } = require('../../serveur/moteur.cjs');
const { createHash } = require('node:crypto');

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
