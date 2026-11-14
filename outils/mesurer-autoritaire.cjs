// Charge reproductible du vrai superviseur : 16 connexions, moteur et bots réels.
const { serveur, Client } = require('../tests/aides/reseau-autoritaire.cjs');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const os = require('node:os');

(async () => {
  const s = await serveur(), clients = [];
  const carte = process.env.WORLD_MAP || 'normal', taille = process.env.WORLD_SIZE || 'moyen';
  const secondes = Number(process.env.WORLD_SECONDS || 20);
  const mesures = () => fetch(s.url.replace('ws:', 'http:').replace('/ws', '/metrics')).then(r => r.json());
  let timer;
  try {
    for (let n = 0; n < 17; n++) clients.push(await new Client(s.url).open());
    const a = clients[0];
    a.send({ t: 'create', settings: { mapType: carte, mapSize: taille, opponents: 4, pacts: true, spawnMode: 'aleatoire' } });
    const room = await a.message('room');
    for (const c of clients.slice(1, 16)) c.send({ t: 'join', code: room.code });
    await a.wait(c => c.messages.some(m => m.t === 'room' && m.players.length === 16));
    clients[16].send({ t: 'join', code: room.code });
    assert.equal((await clients[16].message('error')).code, 'full');
    const joueurs = clients.slice(0, 16), debuts = performance.now();
    a.send({ t: 'start' });
    await Promise.all(joueurs.map(c => c.wait(c => c.state?.data.phase === 'playing', 120000)));
    const preparationMs = performance.now() - debuts;
    assert.equal(a.state.data.players.filter(p => p.human).length, 16);
    const bots = a.state.data.players.filter(p => !p.human).length;
    a.send({ t: 'speed', v: 3 });
    await a.wait(c => c.state.data.speed === 3);
    const avant = await mesures(), debut = performance.now(), tick = a.state.data.tick;
    const comptes = joueurs.map(() => 0), derniers = joueurs.map(c => c.state.seq);
    joueurs.forEach((c, i) => { c.onState = st => { comptes[i]++; derniers[i] = st.seq; }; });
    let ordres = 0, serie = 0;
    timer = setInterval(() => {
      serie++;
      joueurs.forEach((c, slot) => {
        // Des dons réels font travailler validation, économie, résultats et diffusion.
        c.send({ t: 'order', s: serie, o: { k: 'gold', to: (slot + 1) % 16, g: 1 } }); ordres++;
      });
    }, 1000);
    await new Promise(resolve => setTimeout(resolve, secondes * 1000));
    clearInterval(timer);
    const dureeMs = performance.now() - debut, apres = await mesures();
    a.send({ t: 'pause', on: true });
    await Promise.all(joueurs.map(c => c.wait(c => c.state.data.paused)));
    // La pause fixe les données. Les séquences de publication continuent, sans changer le monde.
    const hash = c => {
      const h = createHash('sha256').update(JSON.stringify(c.state.raw.data));
      for (const arr of c.state.raw.arrays.values()) h.update(arr.bytes);
      return h.digest('hex');
    };
    const empreintes = joueurs.map(hash); assert.equal(new Set(empreintes).size, 1);
    const x = avant.parties[0], y = apres.parties[0], delta = k => y[k] - x[k];
    console.log(JSON.stringify({ node: process.version, machine: { cpu: os.cpus()[0].model, coeursLogiques: os.cpus().length, ramGo: os.totalmem() / 2 ** 30 },
      scenario: { carte, taille, humains: 16, bots, vitesse: 3, dureeMs, ordres, preparationMs },
      resultat: { etatsIdentiques: true, hash: empreintes[0], ticks: a.state.data.tick - tick,
        ticksParSeconde: delta('ticks') * 1000 / dureeMs, publicationsParSeconde: delta('publications') * 1000 / dureeMs,
        simulationMs: delta('simMs'), serialisationMs: delta('serialMs'), cpuMs: delta('cpuMs'),
        superviseurCpuMs: apres.superviseur.cpuMs - avant.superviseur.cpuMs,
        emissionMs: apres.diffusionsMs - avant.diffusionsMs,
        octetsEmis: apres.bytesEnvoyes - avant.bytesEnvoyes, receptionHzParClient: comptes.map(n => n * 1000 / dureeMs),
        ecartSequences: Math.max(...derniers) - Math.min(...derniers) }, serveur: apres,
      limites: ['Réseau loopback et clients Node, pas seize navigateurs graphiques.', 'Machine partagée sans quota CPU : ne dimensionne pas un VPS.', 'Échantillon court, sans campagne de charge prolongée.'] }, null, 2));
  } finally { clearInterval(timer); clients.forEach(c => c.close()); await s.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
