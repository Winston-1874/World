// Un processus possède une seule partie. Aucun accès réseau, aucune donnée persistée.
const { performance } = require('node:perf_hooks');
const { gzipSync } = require('node:zlib');
const Etat = require('../js/etat.js');
const { creerSimulation } = require('./simulation.cjs');

let simulation, precedent, seq = 0, turn = 0, dernier = 0, acc = 0, publication = 0, enVol = false;
let config, commandes = [], controles = [], ticks = 0, simMs = 0, simMax = 0, serialMs = 0, publications = 0;
let initMs = 0, debutCpu;
let boucleMaxMs = 0;
function publier() {
  if (enVol || !process.connected) return;
  const debut = performance.now(), actuel = Etat.capturer(simulation.Game);
  const info = { game: config.game, seq: ++seq, base: seq - 1, turn, results: simulation.resultats() };
  const complet = Etat.encoder(actuel, null, info);
  const diff = precedent ? Etat.encoder(actuel, precedent, info) : complet;
  const full = gzipSync(complet, { level: 1 }), delta = precedent ? gzipSync(diff, { level: 1 }) : full;
  serialMs += performance.now() - debut; publications++;
  const cpu = process.cpuUsage(debutCpu);
  enVol = true;
  process.send({ t: 'state', seq, base: precedent ? seq - 1 : null, turn, full, delta,
    metrics: { initMs, ticks, simMs, simMax, serialMs, publications, rss: process.memoryUsage().rss,
      cpuMs: (cpu.user + cpu.system) / 1000, retardMs: acc, boucleMaxMs,
      rssMax: process.resourceUsage().maxRSS * 1024,
      rawBytes: complet.length, fullBytes: full.length, deltaBytes: delta.length } });
  precedent = actuel;
}
process.on('message', m => {
  if (m.t === 'init') {
    if (simulation) return;
    config = m; debutCpu = process.cpuUsage(); const debut = performance.now();
    simulation = creerSimulation(m.options);
    initMs = performance.now() - debut;
    dernier = publication = performance.now();
    publier();
  } else if (m.t === 'received') enVol = false;
  else if (m.t === 'order') {
    if (commandes.length < 320) commandes.push(m);
    else process.send({ t: 'saturated' });
  }
  else if (m.t === 'control') {
    if (controles.length < 64) controles.push(m);
    else process.send({ t: 'saturated' });
  }
});
process.on('disconnect', () => process.exit(0));
setInterval(() => {
  if (!simulation) return;
  const G = simulation.Game, maintenant = performance.now();
  for (const c of controles.splice(0)) {
    if (c.kind === 'pause') G.paused = c.on;
    if (c.kind === 'speed') G.speed = c.v;
    if (c.kind === 'leave') G.runOrder(c.slot, { k: 'leave' });
  }
  boucleMaxMs = Math.max(boucleMaxMs, maintenant - dernier);
  const dt = Math.min(1000, maintenant - dernier); dernier = maintenant;
  if (!G.paused) acc = Math.min(2000, acc + dt * (turn < config.spawnTurns ? 1 : G.speed));
  let n = 0;
  while (!G.paused && acc >= 100 && n++ < 3 && G.phase !== 'over') {
    acc -= 100; turn++;
    for (const m of commandes.splice(0)) simulation.commande(m.slot, m.s, m.o, m.langue);
    if (turn === config.spawnTurns) G.beginOnline();
    const t = performance.now();
    if (G.phase === 'playing') { simulation.avancer(); ticks++; }
    const d = performance.now() - t; simMs += d; simMax = Math.max(simMax, d);
  }
  if (maintenant - publication >= 200) { publication = maintenant; publier(); }
}, 10);
