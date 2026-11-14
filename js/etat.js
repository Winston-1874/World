// État publié par le protocole expérimental 2. Même codec dans Node et le navigateur.
// Les caches, le générateur aléatoire et les fonctions ne traversent jamais le réseau.
const Etat = (() => {
  const CHAMPS = ('mapType mapSize seed W H N terrain owner building level garrison anchor builtBy ' +
    'players attacks expeditions works fortMines defis relics relicRuns relicChurch relicNext nextRelicId ' +
    'walls faithProgress crusades wallAt crossings bridges bridgeAt tradeRoutes returning outposts colonies ' +
    'truces faithTruces nextAttackId pacts nextPactId buildingTiles castles tick placeNames version landCount ' +
    'deposits depositAt depositTile randomGlory gloryMode spots spotMode botSpots botsLater spawnRandom ' +
    'difficulty speed pactsAllowed factions cm hy cr online capExempt phase paused winner gloryWinners ' +
    'gloryShown gloryWinner victoryShown empireShown allianceRequests').split(' ');
  const TYPES = { Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array };
  const MAX = 64 * 1024 * 1024;
  const texte = new TextEncoder(), lecture = new TextDecoder('utf-8', { fatal: true });

  function capturer(game) {
    const arrays = new Map();
    function coder(v, chemin) {
      if (v === undefined) return { $u: 1 };
      if (typeof v === 'number' && !Number.isFinite(v)) return { $n: String(v) };
      if (v === null || typeof v !== 'object') {
        if (typeof v === 'function') throw Error('Fonction dans un état publié');
        return v;
      }
      const type = Object.prototype.toString.call(v).slice(8, -1);
      if (ArrayBuffer.isView(v)) {
        if (!TYPES[type]) throw Error('Tableau inconnu');
        arrays.set(chemin, { type, bytes: new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice() });
        return { $a: chemin };
      }
      if (type === 'Map') return { $m: Array.from(v, ([k, x], i) => [coder(k, chemin + '/k' + i), coder(x, chemin + '/v' + i)]) };
      if (type === 'Set') return { $s: Array.from(v, (x, i) => coder(x, chemin + '/' + i)) };
      if (Array.isArray(v)) return v.map((x, i) => coder(x, chemin + '/' + i));
      const o = {};
      for (const k of Object.keys(v).sort()) o[k] = coder(v[k], chemin + '/' + k);
      return o;
    }
    const data = {};
    for (const k of CHAMPS) data[k] = coder(game[k], k);
    data.map = coder({ W: game.W, H: game.H, N: game.N, shade: game.map.shade }, 'map');
    return { data, arrays };
  }

  function encoder(actuel, precedent, info) {
    const morceaux = [], patches = [], arrays = [];
    let taille = 0;
    for (const [nom, a] of actuel.arrays) {
      arrays.push([nom, a.type, a.bytes.length]);
      const ancien = precedent && precedent.arrays.get(nom);
      const avant = ancien && ancien.type === a.type && ancien.bytes.length === a.bytes.length ? ancien.bytes : null;
      const ajouter = (debut, fin) => {
        const bytes = a.bytes.subarray(debut, fin);
        patches.push([nom, debut, bytes.length]); morceaux.push(bytes); taille += bytes.length;
      };
      if (!avant) { ajouter(0, a.bytes.length); continue; }
      // Regrouper les changements voisins évite un descripteur par octet d'un flottant.
      for (let i = 0; i < a.bytes.length;) {
        if (avant[i] === a.bytes[i]) { i++; continue; }
        const debut = i; let fin = ++i;
        while (i < a.bytes.length && i - fin < 16) { if (avant[i] !== a.bytes[i]) fin = i + 1; i++; }
        ajouter(debut, fin);
      }
    }
    const head = texte.encode(JSON.stringify({ protocol: 2, schema: 1, ...info, base: precedent ? info.base : null,
      data: actuel.data, arrays, patches }));
    if (head.length > 8 * 1024 * 1024 || taille + head.length + 4 > MAX) throw Error('État trop volumineux');
    const packet = new Uint8Array(4 + head.length + taille);
    new DataView(packet.buffer).setUint32(0, head.length, true);
    packet.set(head, 4); let pos = 4 + head.length;
    for (const m of morceaux) { packet.set(m, pos); pos += m.length; }
    return packet;
  }

  function appliquer(packet, precedent = null) {
    packet = packet instanceof Uint8Array ? packet : new Uint8Array(packet);
    if (packet.length < 4 || packet.length > MAX) throw Error('Paquet invalide');
    const n = new DataView(packet.buffer, packet.byteOffset, packet.byteLength).getUint32(0, true);
    if (n > 8 * 1024 * 1024 || n + 4 > packet.length) throw Error('En-tête invalide');
    const h = JSON.parse(lecture.decode(packet.subarray(4, 4 + n)));
    if (h.protocol !== 2 || h.schema !== 1 || !Number.isSafeInteger(h.seq) || h.seq < 1 || typeof h.game !== 'string' ||
        !Number.isSafeInteger(h.turn) || h.turn < 0 || (h.base !== null && (!Number.isSafeInteger(h.base) || h.base < 1))) throw Error('Version invalide');
    if (h.base !== null && (!precedent || precedent.game !== h.game || precedent.seq !== h.base || h.seq <= h.base)) throw Error('Base absente');
    if (precedent && precedent.game === h.game && h.seq < precedent.seq) throw Error('État ancien');
    const arrays = new Map(), complets = new Set(); let total = 0;
    for (const [nom, type, taille] of h.arrays) {
      if (typeof nom !== 'string' || arrays.has(nom) || !Object.hasOwn(TYPES, type) || !Number.isSafeInteger(taille) ||
          taille < 0 || taille % TYPES[type].BYTES_PER_ELEMENT || (total += taille) > MAX) throw Error('Tableau invalide');
      const ancien = h.base !== null && precedent.raw.arrays.get(nom);
      const reutilisable = ancien && ancien.type === type && ancien.bytes.length === taille;
      arrays.set(nom, { type, bytes: reutilisable ? ancien.bytes.slice() : new Uint8Array(taille) });
      if (!reutilisable) complets.add(nom);
    }
    let pos = 4 + n;
    for (const [nom, debut, taille] of h.patches) {
      const a = arrays.get(nom);
      if (!a || !Number.isSafeInteger(debut) || !Number.isSafeInteger(taille) || debut < 0 || taille < 0 ||
          debut + taille > a.bytes.length || pos + taille > packet.length) throw Error('Différence invalide');
      if (complets.has(nom)) {
        if (debut !== 0 || taille !== a.bytes.length) throw Error('Tableau incomplet');
        complets.delete(nom);
      }
      a.bytes.set(packet.subarray(pos, pos + taille), debut); pos += taille;
    }
    if (pos !== packet.length || complets.size) throw Error('Longueur invalide ou tableau incomplet');
    function decoder(v) {
      if (!v || typeof v !== 'object') return v;
      if (Array.isArray(v)) return v.map(decoder);
      if (Object.hasOwn(v, '$u')) return undefined;
      if (Object.hasOwn(v, '$n')) return Number(v.$n);
      if (Object.hasOwn(v, '$a')) {
        const a = arrays.get(v.$a); if (!a) throw Error('Tableau absent');
        return new TYPES[a.type](a.bytes.slice().buffer);
      }
      if (Object.hasOwn(v, '$m')) return new Map(v.$m.map(([k, x]) => [decoder(k), decoder(x)]));
      if (Object.hasOwn(v, '$s')) return new Set(v.$s.map(decoder));
      const o = {};
      for (const k of Object.keys(v)) {
        if (['__proto__', 'constructor', 'prototype'].includes(k)) throw Error('Clé interdite');
        o[k] = decoder(v[k]);
      }
      return o;
    }
    return { game: h.game, seq: h.seq, turn: h.turn, results: h.results || [], data: decoder(h.data), raw: { data: h.data, arrays } };
  }

  function installer(game, data, me) {
    const anciens = game.players;
    for (const k of Object.keys(game)) delete game[k];
    Object.assign(game, data);
    // Les callbacks de l'interface gardent parfois une référence à leur royaume.
    if (anciens && anciens.length === game.players.length) game.players = game.players.map((p, i) => {
      const ancien = anciens[i];
      for (const k of Object.keys(ancien)) delete ancien[k];
      return Object.assign(ancien, p);
    });
    game.map.terrain = game.terrain;
    game.authoritative = true; game.online = true;
    game.human = game.players[me];
    for (const p of game.players) p.isHuman = p.id === me;
    game.routeCache = new Map(); game.assaultPlans = new Map();
    game.regionsVersion = game.nbStatsVersion = game.roadsVersion = game.walledPortsVersion = game.slotVersion = -1;
    game.roadsTick = -1; game.inUpdate = false;
  }
  return { CHAMPS, MAX, capturer, encoder, appliquer, installer };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Etat;
