// Comparaison courte et déterministe du vrai processus de partie, sans recette graphique.
const { fork } = require('node:child_process');
const { gunzipSync } = require('node:zlib');
const path = require('node:path');
const Etat = require('../js/etat.js');
const secondes = 10;
const enfant = fork(path.resolve(__dirname, '../serveur/partie.cjs'), [], {
  serialization: 'advanced', execArgv: ['--max-old-space-size=512'], stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
});
let state, debut, avant, fin, reprise = false, demande = false, debutCpu;
const timeout = setTimeout(() => { console.error('Mesure interrompue : délai dépassé'); enfant.kill(); process.exitCode = 1; }, 45000);
enfant.on('exit', () => clearTimeout(timeout));
enfant.on('message', m => {
  if (m.t !== 'state') return;
  try {
    const packet = state && m.base === state.seq ? m.delta : m.full;
    if (!packet && demande && !reprise) { enfant.send({ t: 'received' }); return; }
    if (!packet) throw Error('État complet demandé absent');
    const actuel = Etat.appliquer(gunzipSync(packet), state);
    // Contrôle des deux encodages quand un complet est disponible.
    if (m.full) {
      const complet = Etat.appliquer(gunzipSync(m.full));
      require('node:assert/strict').deepEqual(actuel.data, complet.data);
    }
    state = actuel;
    enfant.send({ t: 'received' });
    if (!debut && state.data.phase === 'playing') enfant.send({ t: 'control', kind: 'speed', v: 3 });
    if (!debut && state.data.speed === 3) { debut = performance.now(); avant = m.metrics; debutCpu = process.cpuUsage(); }
    if (!debut) return;
    const dureeMs = performance.now() - debut;
    if (demande && !reprise) { reprise = true; }
    if (!demande && dureeMs >= 4000) {
      // Une perte de base, comme après reconnexion, exige un complet à la publication suivante.
      enfant.send({ t: 'full' }); state = null; demande = true;
    }
    if (dureeMs < secondes * 1000 || fin) return;
    fin = true;
    const cpu = process.cpuUsage(debutCpu), d = k => m.metrics[k] - avant[k];
    console.log(JSON.stringify({ node: process.version, scenario: { carte: 'normal', taille: 'grand', seed: 123456,
      humains: 16, bots: 4, vitesse: 3, secondes, repriseDemandee: true },
      mesure: { dureeMs, repriseExacte: reprise, ticks: d('ticks'), publications: d('publications'),
        ticksHz: d('ticks') * 1000 / dureeMs, publicationsHz: d('publications') * 1000 / dureeMs,
        serialMs: d('serialMs'), simMs: d('simMs'), cpuMs: d('cpuMs'),
        complets: m.metrics.complets === undefined ? d('publications') : d('complets'),
        decodeurCpuMs: (cpu.user + cpu.system) / 1000 }, metrics: m.metrics,
      limite: 'Processus réel et IPC ; décodage de contrôle local, sans navigateur ni diffusion réseau à 16 clients.' }, null, 2));
    enfant.kill();
  } catch (e) { console.error(e); process.exitCode = 1; enfant.kill(); }
});
enfant.send({ t: 'init', game: 'mesure', spawnTurns: 10, options: { online: true, seed: 123456,
  mapType: 'normal', mapSize: 'grand', difficulty: 'normal', pacts: true, spawnRandom: true, opponents: 4,
  humans: Array.from({ length: 16 }, (_, i) => ({ name: 'Royaume ' + i, banner: i })) } });
