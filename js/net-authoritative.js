// Adaptateur expérimental : ?autoritaire=1 et serveur lancé avec AUTHORITATIVE=1.
// Le navigateur applique des états ; il ne lance ni génération de carte, ni règles, ni bots.
const Autoritaire = {
  enabled: new URLSearchParams(location.search).get('autoritaire') === '1',
  state: null, ticket: null, transfer: null, ready: false, ended: false, retry: null,
  demandes: new Set(), metrics: { states: 0, bytes: 0, decodeMs: 0, resumes: 0 },
  status(texte, erreur = false) {
    UI.netStatus(texte, erreur ? 'warn' : 'good');
    if (Game.authoritative) UI.log(texte, erreur ? 'warn' : 'good');
  },
  connect(first) {
    if (Net.ws && Net.ws.readyState <= 1) return Net.send(first);
    const ws = new WebSocket(Net.url());
    Net.ws = ws; Net.outbox = first ? [first] : []; ws.binaryType = 'arraybuffer';
    let chaine = Promise.resolve();
    ws.onopen = () => {
      Net.send({ t: 'hello', protocol: 2, langue: LANG, ...UI.netProfile() });
      for (const m of Net.outbox) Net.send(m);
      Net.outbox = [];
    };
    ws.onmessage = e => {
      chaine = chaine.then(() => { if (Net.ws === ws) return this.message(e.data, ws); }).catch(err => {
        if (Net.ws !== ws) return;
        this.status(tr('État reçu invalide : reprise depuis le serveur.', 'Invalid state received: recovering from server.'), true);
        console.error(err);
        this.transfer = null; Net.send({ t: 'resync' });
      });
    };
    ws.onclose = () => {
      if (Net.ws !== ws) return;
      Net.ws = null; this.transfer = null; this.ready = false;
      if (this.ended) return;
      if (!this.ticket) { Net.room = null; UI.showRoom(null); return; }
      this.deadline ||= Date.now() + this.ticket.grace;
      this.status(tr('Connexion interrompue. La partie reste sur le serveur ; reconnexion en cours…',
        'Connection interrupted. The game stays on the server; reconnecting…'), true);
      this.reconnecter();
    };
  },
  reconnecter() {
    clearTimeout(this.retry);
    if (this.ended || !this.ticket) return;
    if (Date.now() >= this.deadline) return this.terminer('expired');
    this.retry = setTimeout(() => {
      try { this.connect({ t: 'resume', code: this.ticket.code, token: this.ticket.token }); }
      catch { this.reconnecter(); }
    }, 1000);
  },
  terminer(code) {
    this.ended = true; this.ready = false; clearTimeout(this.retry);
    this.status(code === 'expired'
      ? tr('Le délai de reconnexion est dépassé. Reviens au menu pour une nouvelle partie.', 'The reconnect window expired. Return to the menu for a new game.')
      : tr('La simulation est arrêtée. Reviens au menu pour une nouvelle partie.', 'The simulation stopped. Return to the menu for a new game.'), true);
    if (Game.authoritative) Game.paused = true;
    if (Net.ws) Net.ws.close();
  },
  async message(data, ws = Net.ws) {
    if (typeof data === 'string') {
      const m = JSON.parse(data);
      if (m.t === 'start') {
        if (m.protocol !== 2) throw Error('Protocole inattendu');
        this.pending = m; this.ticket = { code: m.code, token: m.token, grace: m.grace };
        Net.game = { slot: m.me, public: m.public, host: m.host, rules: m.rules, id: m.game };
        Net.spawnTurns = m.spawnTurns; Net.seq = Math.max(Net.seq, m.lastSeq);
        this.status(tr('Préparation du monde sur le serveur…', 'Preparing the world on the server…'));
        return;
      }
      if (m.t === 'state') {
        if (!Number.isSafeInteger(m.bytes) || m.bytes < 1 || m.bytes > 16 * 1048576 || m.compression !== 'gzip') throw Error('Transfert invalide');
        this.transfer = { id: m.transfer, index: 0, offset: 0, bytes: new Uint8Array(m.bytes) }; return;
      }
      if (m.t === 'ended' || (m.t === 'error' && ['expired', 'protocol'].includes(m.code))) return this.terminer(m.code);
      if (m.t === 'rejected') {
        const w = Net.waiting.get(m.s); Net.waiting.delete(m.s);
        const msg = tr('Ordre refusé par le serveur.', 'Order rejected by the server.');
        if (w?.done) w.done(msg, w.beforeValue); else this.status(msg, true);
        return;
      }
      if (m.t === 'error' && m.code === 'capacity') return this.status(tr('Le serveur est à sa capacité maximale. Réessaie plus tard.', 'The server is at capacity. Try again later.'), true);
      Net.onMessage(m); return;
    }
    const f = this.transfer, bytes = new Uint8Array(data);
    if (!f || bytes.length > 32768 || f.offset + bytes.length > f.bytes.length) throw Error('Morceau invalide');
    f.bytes.set(bytes, f.offset); f.offset += bytes.length; this.metrics.bytes += bytes.length;
    if (f.offset === f.bytes.length) {
      const debut = performance.now();
      const reader = new Blob([f.bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
      const morceaux = []; let taille = 0;
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        taille += value.length;
        if (taille > Etat.MAX) { await reader.cancel(); throw Error('État décompressé trop grand'); }
        morceaux.push(value);
      }
      // Une décompression peut finir après une coupure : ne jamais installer l'ancien flux.
      if (Net.ws !== ws || this.transfer !== f) return;
      const packet = new Uint8Array(taille); let p = 0;
      for (const b of morceaux) { packet.set(b, p); p += b.length; }
      const suivant = Etat.appliquer(packet, this.state);
      if (suivant.game !== Net.game.id) throw Error('Partie inattendue');
      this.installer(suivant);
      this.metrics.decodeMs += performance.now() - debut; this.metrics.states++;
      this.transfer = null;
    }
    Net.send({ t: 'stateAck', transfer: f.id, index: f.index++ });
  },
  installer(state) {
    const initial = !this.state || this.state.game !== state.game;
    const retour = !initial && !this.ready;
    const owner = Game.owner, building = Game.building, wall = Game.wallAt;
    this.state = state; Net.turn = state.turn;
    // Les noms automatiques sont localisés ; les noms saisis par les humains restent intacts.
    for (const p of state.data.players) if (p.nameKey >= 0) p.name = KINGDOMS[p.nameKey];
    for (const pact of state.data.pacts.values()) {
      const p = state.data.players[pact.founder];
      if (p && !pact.eternal) pact.name = tr(`Pacte ${Game.deName(p.name)}`, `Pact of ${p.name}`);
    }
    if (initial) {
      this.demandes.clear(); Net.room = null;
      UI.startOnline({ ...this.pending, state: state.data });
    } else {
      Etat.installer(Game, state.data, Net.game.slot);
      for (let i = 0; i < Game.N; i++) if (owner[i] !== Game.owner[i] || building[i] !== Game.building[i] || wall[i] !== Game.wallAt[i]) Render.markDirty(i);
    }
    this.ready = true; this.deadline = 0;
    UI.refreshPauseButton(); UI.refreshHostButtons();
    Net.onSpeed(Game.speed);
    Replay.record(Game);
    for (const r of state.results) if (r.slot === Net.game.slot && Net.waiting.has(r.s)) {
      const w = Net.waiting.get(r.s); Net.waiting.delete(r.s);
      for (const e of r.effets || []) {
        if (e.k === 'log') UI.log(...e.args);
        if (e.k === 'sound') Music.sound(...e.args);
      }
      if (w.done) w.done(r.result, w.beforeValue);
    }
    const actives = new Set();
    for (const [k, r] of Game.allianceRequests || []) {
      const cle = k + ':' + r.tick;
      actives.add(cle);
      if (r.to === Net.game.slot && !this.demandes.has(cle) && UI.askAlliance(Game.players[r.from])) this.demandes.add(cle);
    }
    for (const cle of this.demandes) if (!actives.has(cle)) this.demandes.delete(cle);
    if (!Game.human.alive && !this.defaite) { this.defaite = true; UI.showEnd(false, false, 'spectate'); }
    if (Game.winner !== undefined && !this.victoire) { this.victoire = true; UI.showEnd(Game.gloryWinners.includes(Net.game.slot), false, 'online'); }
    if (retour) {
      this.metrics.resumes++;
      this.status(tr('Connexion rétablie : état du serveur récupéré.', 'Connection restored: server state recovered.'));
      // Réémettre uniquement les ordres non confirmés ; les numéros protègent contre les doublons.
      for (const [s, w] of Net.waiting) Net.send({ t: 'order', s, o: w.order });
    }
  },
  ordre(o, done, before) {
    if (!this.ready || !Net.ws || Net.ws.readyState !== 1 || Net.waiting.size >= 32) {
      const msg = tr('Attends la connexion au serveur avant de donner un ordre.', 'Wait for the server connection before issuing an order.');
      if (done) done(msg); else this.status(msg, true); return;
    }
    const s = ++Net.seq;
    Net.waiting.set(s, { done, beforeValue: before ? before() : null, order: o });
    Net.send({ t: 'order', s, o });
  },
};

if (Autoritaire.enabled) {
  Net.connect = first => Autoritaire.connect(first);
  Net.sendOrder = (o, done, before) => Autoritaire.ordre(o, done, before);
  Net.pump = () => {}; // aucun tour ni règle exécuté dans ce navigateur
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Autoritaire.ready && !Autoritaire.transfer) Net.send({ t: 'resync' });
  });
}
