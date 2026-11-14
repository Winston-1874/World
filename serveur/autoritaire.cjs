const crypto = require('node:crypto');
const path = require('node:path');
const { fork } = require('node:child_process');
const { validOrder } = require('./ordres.cjs');

function creerAutoritaire({ send, sendFrame, closeConn, cleanSettings, limite, cartes = ['normal'], royaumesPublics = 10 }) {
  const maxParties = limite('MAX_ACTIVE_GAMES', 2, 1, 16);
  const maxSalons = limite('MAX_ROOMS', 32, 2, 4096);
  const grace = limite('RECONNECT_SECONDS', 60, 1, 600) * 1000;
  const initTimeout = limite('GAME_INIT_SECONDS', 120, 5, 600) * 1000;
  const tas = limite('GAME_HEAP_MB', 512, 128, 2048);
  const rssMax = limite('GAME_RSS_MB', 768, 128, 4096) * 1048576;
  const spawnTurns = limite('AUTH_SPAWN_SECONDS', 15, 1, 60) * 10;
  const periode = limite('PUBLIC_SECONDS', 120, 1, 3600) * 1000;
  const salons = new Map(); let publicRoom, transfert = 0, bytesEnvoyes = 0, transmissions = 0, diffusionsMs = 0;
  const erreur = (c, code) => send(c, { t: 'error', code });
  const actifs = () => [...salons.values()].filter(r => r.game).length;
  function nouveau(pub, settings) {
    let code;
    do { code = crypto.randomBytes(2).toString('hex').toUpperCase(); } while (salons.has(code));
    const r = { code, public: pub, host: null, members: [], settings: cleanSettings(settings), startsAt: Date.now() + periode };
    salons.set(code, r); return r;
  }
  const hasard = liste => liste[Math.floor(Math.random() * liste.length)];
  function ouvrirPublic() { publicRoom = nouveau(true, { mapType: hasard(cartes), opponents: 0,
    mapSize: hasard(['moyen', 'grand']), pacts: Math.random() < 0.5, spawnMode: 'places' }); }
  const reglages = r => r.public ? { ...r.settings, opponents: Math.max(0, royaumesPublics - r.members.length) } : r.settings;
  function afficher(r) {
    for (const c of [...r.members]) send(c, { t: 'room', protocol: 2, code: r.code, public: r.public, host: r.host, you: c.id,
      players: r.members.map(p => ({ id: p.id, name: p.name, banner: p.banner })), settings: reglages(r),
      startsIn: r.public ? Math.max(0, r.startsAt - Date.now()) : null, rules: { pauseTime: 15000, pauseEvery: 300000 } });
  }
  function arreter(r, code = 'ended') {
    const g = r.game;
    if (g && g.stopped) return;
    if (g) {
      g.stopped = true; g.current = null;
      for (const s of g.slots) if (s.conn) {
        s.conn.transfer = null; s.conn.authRoom = null;
        send(s.conn, { t: 'ended', code });
      }
      g.child.kill('SIGKILL');
    }
    salons.delete(r.code);
  }
  function quitter(c, volontaire = false) {
    const r = c.authRoom; c.authRoom = null; c.transfer = null;
    if (!r) return;
    if (!r.game) {
      r.members = r.members.filter(p => p !== c);
      if (!r.public && !r.members.length) { salons.delete(r.code); return; }
      if (r.host === c.id) r.host = r.members[0]?.id ?? null;
      afficher(r); return;
    }
    const g = r.game, s = g.slots.find(p => p.conn === c);
    if (!s) return;
    s.conn = null; s.expires = Date.now() + (volontaire ? 0 : grace);
    if (g.host === s.slot) {
      g.host = g.slots.findIndex(p => p.conn);
      for (const p of g.slots) if (p.conn) send(p.conn, { t: 'host', slot: g.host });
      g.paused = false; g.pauseUntil = 0; controle(g, { kind: 'pause', on: false });
    }
  }
  function rejoindre(c, r) {
    if (c.authRoom === r) return;
    if (r.game) return erreur(c, 'started');
    if (r.members.length >= 16) return erreur(c, 'full');
    quitter(c, true); c.authRoom = r; r.members.push(c);
    if (!r.public && r.host === null) r.host = c.id;
    afficher(r);
  }
  function envoyerDebut(r, s) {
    send(s.conn, { t: 'start', protocol: 2, game: r.game.id, code: r.code, token: s.token,
      settings: r.settings, players: r.game.players, seed: r.game.seed, me: s.slot, host: r.game.host,
      public: r.public, spawnTurns, lastSeq: s.lastSeq, grace, rules: { pauseTime: 15000, pauseEvery: 300000 } });
    s.conn.startSent = true;
  }
  function morceau(c) {
    const f = c.transfer;
    if (!f) return;
    const debut = performance.now();
    const b = f.bytes.subarray(f.offset, Math.min(f.bytes.length, f.offset + 32768));
    f.sent = b.length;
    sendFrame(c, 2, b);
    bytesEnvoyes += b.length;
    diffusionsMs += performance.now() - debut;
  }
  function transmettre(c, g) {
    if (c.transfer || !g.current || !c.startSent) return;
    const p = g.current;
    if (c.applied === p.seq) return;
    const bytes = c.applied === p.base && !c.resync ? p.delta : p.full;
    c.resync = false;
    c.transfer = { id: ++transfert, seq: p.seq, bytes, offset: 0, index: 0, sent: 0, since: Date.now() };
    c.lastTransfer = c.transfer.id;
    send(c, { t: 'state', transfer: c.transfer.id, seq: p.seq, bytes: bytes.length, compression: 'gzip' });
    morceau(c); transmissions++;
  }
  function controle(g, m) {
    if (g.child.connected && !g.child.send({ t: 'control', ...m })) arreter(g.room, 'resources');
  }
  function lancer(r) {
    if (actifs() >= maxParties || (r.public && salons.size >= maxSalons)) return false;
    r.settings = reglages(r);
    const players = r.members.map((c, i) => ({ name: c.name + (r.members.some((p, j) => j < i && p.name === c.name) ? ' ' + (i + 1) : ''), banner: c.banner }));
    const seed = crypto.randomBytes(4).readUInt32LE();
    const child = fork(path.join(__dirname, 'partie.cjs'), [], { serialization: 'advanced', execArgv: [`--max-old-space-size=${tas}`], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    const g = r.game = { room: r, child, id: crypto.randomBytes(12).toString('hex'), seed, players, host: r.public ? -1 : r.members.findIndex(c => c.id === r.host),
      slots: r.members.map((conn, slot) => ({ conn, slot, token: crypto.randomBytes(32).toString('hex'), expires: 0, lastSeq: 0, lastPause: 0 })),
      created: Date.now(), paused: false, pauseUntil: 0, metrics: null, stopped: false };
    for (const s of g.slots) { s.conn.applied = 0; envoyerDebut(r, s); }
    child.stderr.on('data', () => {}); // éviter de bloquer l'enfant ; les erreurs remontent par ended
    child.on('error', () => arreter(r, 'simulation'));
    child.on('exit', () => { if (!g.stopped) arreter(r, 'simulation'); });
    child.on('message', m => {
      if (m.t === 'saturated' && !g.stopped) return arreter(r, 'resources');
      if (m.t !== 'state' || g.stopped) return;
      g.metrics = m.metrics;
      if (m.metrics.rss > rssMax || m.full.length > 16 * 1048576 || m.delta.length > 16 * 1048576) return arreter(r, 'resources');
      g.current = m;
      for (const s of g.slots) if (s.conn) {
        if (!s.conn.startSent) envoyerDebut(r, s);
        transmettre(s.conn, g);
      }
      if (child.connected) child.send({ t: 'received' });
    });
    child.send({ t: 'init', game: g.id, spawnTurns, options: { ...r.settings, online: true, seed, humans: players,
      spotMode: r.settings.spawnMode === 'places', spawnRandom: r.settings.spawnMode === 'aleatoire' } });
    if (r.public) ouvrirPublic();
    return true;
  }
  function onMessage(c, m) {
    if (m.t === 'hello') {
      if (m.protocol !== 2) { erreur(c, 'protocol'); return closeConn(c); }
      if (c.hello) return;
      c.hello = true; c.name = String(m.name || 'Royaume').replace(/[<>\u0000-\u001f]/g, '').slice(0, 20);
      c.banner = Math.max(0, Math.min(1000, m.banner | 0)); c.langue = m.langue === 'fr' ? 'fr' : 'en'; return;
    }
    if (!c.hello) return;
    const r = c.authRoom, g = r?.game;
    if (m.t === 'resume') {
      const room = salons.get(m.code), game = room?.game;
      const s = game?.slots.find(p => p.token === m.token && p.token && !p.conn && p.expires > Date.now());
      if (!s || c.authRoom) return erreur(c, 'expired');
      s.conn = c; s.expires = 0; c.authRoom = room; c.applied = 0;
      if (game.host < 0 && !room.public) game.host = s.slot;
      envoyerDebut(room, s); transmettre(c, game); return;
    }
    if (m.t === 'create') {
      if (salons.size >= maxSalons) return erreur(c, 'capacity');
      return rejoindre(c, nouveau(false, m.settings));
    }
    if (m.t === 'public') return rejoindre(c, publicRoom);
    if (m.t === 'join') {
      const room = salons.get(String(m.code || '').toUpperCase());
      if (!room || room.public) return erreur(c, 'noroom');
      return rejoindre(c, room);
    }
    if (m.t === 'leave') return quitter(c, true);
    if (!r) return;
    if (!g) {
      if (m.t === 'settings' && r.host === c.id && !r.public) { r.settings = cleanSettings(m.settings); afficher(r); }
      if (m.t === 'profile') { c.name = String(m.name || 'Royaume').replace(/[<>\u0000-\u001f]/g, '').slice(0, 20); c.banner = Math.max(0, Math.min(1000, m.banner | 0)); afficher(r); }
      if (m.t === 'start' && !r.public && r.host === c.id && !lancer(r)) erreur(c, 'capacity');
      return;
    }
    const s = g.slots.find(p => p.conn === c);
    if (!s) return;
    if (m.t === 'stateAck') {
      const f = c.transfer;
      // resync peut croiser l'acquittement d'un ancien morceau sur l'autre sens du socket.
      if (Number.isSafeInteger(m.transfer) && m.transfer <= c.lastTransfer && (!f || m.transfer < f.id)) return;
      if (!f || m.transfer !== f.id || m.index !== f.index) return closeConn(c);
      f.offset += f.sent; f.index++; f.since = Date.now();
      if (f.offset < f.bytes.length) return morceau(c);
      c.applied = f.seq; c.transfer = null; transmettre(c, g); return;
    }
    if (m.t === 'resync') { c.applied = 0; c.resync = true; c.transfer = null; transmettre(c, g); return; }
    if (m.t === 'order') {
      if (!Number.isSafeInteger(m.s) || m.s < 1 || m.s > 2147483647 || !validOrder(m.o)) return send(c, { t: 'rejected', s: m.s, code: 'invalid' });
      if (m.s <= s.lastSeq) return; // le résultat reste dans les états, jamais de double exécution
      const window = Math.floor(Date.now() / 100);
      if (s.window !== window) { s.window = window; s.orders = 0; }
      if (++s.orders > 20 || !g.child.connected) return send(c, { t: 'rejected', s: m.s, code: 'capacity' });
      s.lastSeq = m.s;
      // send=false : canal IPC saturé, fermer la partie plutôt qu'accumuler une file.
      if (!g.child.send({ t: 'order', slot: s.slot, s: m.s, o: m.o, langue: c.langue })) arreter(r, 'resources');
      return;
    }
    if (m.t === 'speed' && !r.public && g.host === s.slot && [1, 1.5, 2, 3].includes(m.v)) {
      controle(g, { kind: 'speed', v: m.v }); return;
    }
    if (m.t === 'pause' && typeof m.on === 'boolean' && !r.public && g.current?.turn >= spawnTurns) {
      if (g.host !== s.slot) {
        if (!m.on && g.pauseBy !== s.slot) return;
        if (m.on && (g.paused || Date.now() - s.lastPause < 300000)) return erreur(c, 'pause');
        if (m.on) s.lastPause = Date.now();
      }
      g.paused = m.on; g.pauseBy = s.slot; g.pauseUntil = m.on && g.host !== s.slot ? Date.now() + 15000 : 0;
      controle(g, { kind: 'pause', on: m.on });
    }
  }
  ouvrirPublic();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const r of salons.values()) {
      const g = r.game;
      if (!g) {
        if (r.public && now >= r.startsAt) {
          if (!r.members.length || !lancer(r)) { r.startsAt = now + periode; afficher(r); }
        }
        continue;
      }
      if (!g.current && now - g.created > initTimeout) { arreter(r, 'timeout'); continue; }
      for (const s of g.slots) {
        if (s.conn?.transfer && now - s.conn.transfer.since > 10000) closeConn(s.conn);
        if (!s.conn && s.token && now >= s.expires) {
          s.token = null; controle(g, { kind: 'leave', slot: s.slot });
        }
      }
      if (!g.slots.some(s => s.conn || s.token)) { arreter(r); continue; }
      if (g.pauseUntil && now >= g.pauseUntil) {
        g.paused = false; g.pauseUntil = 0; controle(g, { kind: 'pause', on: false });
      }
    }
  }, 250);
  return { onMessage, drop: c => quitter(c), salons,
    metrics: () => ({ protocol: 2, active: actifs(), rooms: salons.size, bytesEnvoyes, transmissions, diffusionsMs,
      superviseur: { rss: process.memoryUsage().rss, rssMax: process.resourceUsage().maxRSS * 1024,
        cpuMs: (process.cpuUsage().user + process.cpuUsage().system) / 1000 },
      parties: [...salons.values()].filter(r => r.game).map(r => r.game.metrics) }),
    fermer() { clearInterval(timer); for (const r of [...salons.values()]) arreter(r); },
  };
}
module.exports = { creerAutoritaire };
