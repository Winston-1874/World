// Mesure isolée, sans affichage, sans modifier les règles ni désactiver le replay.
// Usage : node outils/mesurer-moteur.cjs [normal|europe] [moyen|grand] [tours]
const { performance } = require('node:perf_hooks');
const { cpus } = require('node:os');
const { creerMoteur, empreinteEtat } = require('../tests/aides/moteur.cjs');

const [carte = 'normal', taille = 'moyen', toursTexte = '6000'] = process.argv.slice(2);
const tours = Number(toursTexte);
if (!['normal', 'europe'].includes(carte) || !['petit', 'moyen', 'grand'].includes(taille) ||
    !Number.isSafeInteger(tours) || tours < 1 || tours > 100000) throw new Error('Paramètres de mesure invalides');
const cpuDebut = process.cpuUsage(), debut = performance.now();
const { Game, Replay } = creerMoteur({ mapType: carte, mapSize: taille, opponents: 0,
  humans: Array.from({ length: 16 }, (_, i) => ({ name: `Royaume ${i + 1}`, banner: i })) });
Game.runOrder(0, { k: 'begin' });
// Chemin de règles normal : les humains partis deviennent des bots.
for (let i = 0; i < 16; i++) Game.runOrder(i, { k: 'leave' });
const initialisationMs = performance.now() - debut;
const temps = [], simulationDebut = performance.now();
for (let i = 0; i < tours && Game.phase === 'playing'; i++) {
  const t = performance.now(); Game.update(); temps.push(performance.now() - t);
}
const simulationMs = performance.now() - simulationDebut;
const cpu = process.cpuUsage(cpuDebut), memoire = process.memoryUsage(), pic = process.resourceUsage().maxRSS;
temps.sort((a, b) => a - b);
const quantile = q => temps[Math.min(temps.length - 1, Math.floor(temps.length * q))];
console.log(JSON.stringify({
  node: process.version, plateforme: process.platform, cpu: cpus()[0].model,
  carte, taille, graine: 123456, royaumes: Game.players.length,
  toursDemandes: tours, toursEffectifs: Game.tick, phaseFinale: Game.phase,
  initialisationMs, simulationMs, moyenneMs: simulationMs / temps.length,
  p50Ms: quantile(.5), p95Ms: quantile(.95), p99Ms: quantile(.99), maximumMs: temps.at(-1),
  toursPlusDe33ms: temps.filter(t => t > 1000 / 30).length,
  cpuMs: (cpu.user + cpu.system) / 1000, rssFinalMio: memoire.rss / 1048576,
  picRssMio: pic / 1024, replayImages: Replay.rec.frames.length,
  empreinteComplete: empreinteEtat(Game),
  exclusions: 'Affichage, réseau, sérialisation, TLS ; mesures dans une VM Node, machine potentiellement partagée.',
}, null, 2));
