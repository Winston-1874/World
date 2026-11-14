// Dépendance de recette uniquement : PLAYWRIGHT_MODULE=/chemin/vers/playwright.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { serveur } = require('../tests/aides/reseau-autoritaire.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const dossier = process.env.WORLD_ARTIFACTS || '/tmp/world-recette'; fs.mkdirSync(dossier, { recursive: true });
  const s = await serveur({ AUTH_SPAWN_SECONDS: '3' }), browsers = [], erreurs = [];
  const url = s.url.replace('ws:', 'http:').replace('/ws', '/?autoritaire=1');
  try {
    const pages = [];
    for (const langue of ['fr', 'en']) {
      const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', headless: true });
      browsers.push(browser);
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); pages.push(page);
      page.on('pageerror', e => erreurs.push(langue + ': ' + e.message));
      await page.addInitScript(lang => localStorage.setItem('medievalEmperor.lang', lang), langue);
      await page.goto(url); await page.waitForFunction(() => typeof UI !== 'undefined');
      await page.evaluate(() => {
        window.appelsRegles = { init: 0, update: 0, runOrder: 0 };
        for (const k of Object.keys(window.appelsRegles)) {
          const original = GameRules[k]; GameRules[k] = function(...args) { window.appelsRegles[k]++; return original.apply(this, args); };
        }
      });
    }
    const [a, b] = pages;
    await a.selectOption('#mapSize', 'petit'); await a.selectOption('#opponents', '4');
    await a.selectOption('#pacts', 'oui');
    await a.click('#netCreate'); await a.waitForFunction(() => Net.room);
    await a.screenshot({ path: path.join(dossier, 'salon-vide-fr.png') });
    await a.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: async texte => { window.lienCopie = texte; } } }));
    await a.click('#netCopy');
    const invitation = await a.evaluate(() => window.lienCopie);
    assert.equal(new URL(invitation).searchParams.get('autoritaire'), '1');
    const code = await a.evaluate(() => Net.room.code);
    await b.fill('#netCode', code); await b.click('#netJoin');
    await a.waitForFunction(() => Net.room.players.length === 2);
    await a.screenshot({ path: path.join(dossier, 'salon-fr.png') });
    await a.click('#netGo');
    await Promise.all(pages.map(p => p.waitForFunction(() => Autoritaire.ready && Game.phase === 'playing', { timeout: 30000 })));
    await a.evaluate(() => UI.act({ k: 'ally', to: 1 }));
    await b.waitForSelector('#log .request button[data-yes]'); await b.click('#log .request button[data-yes]');
    await a.waitForFunction(() => Game.areAllied(0, 1));
    await a.evaluate(() => UI.act({ k: 'gold', to: 1, g: 10 }));
    await a.waitForFunction(() => Net.waiting.size === 0);
    const cible = await a.evaluate(() => {
      const i = Game.owner.findIndex((p, i) => p < 0 && Game.claimable(i) && Game.hasNeighbor(i, j => Game.owner[j] === Game.human.id));
      UI.act({ k: 'attack', target: -1, aim: i, src: -1, troops: Game.human.troops * 0.3 });
      return i;
    });
    assert.ok(cible >= 0);
    await a.waitForFunction(i => Game.attacks.some(x => x.attacker === Game.human.id) || Game.owner[i] === Game.human.id, cible);
    // Le moteur serveur continue pendant le gel réel du deuxième navigateur.
    const session = await b.context().newCDPSession(b);
    const avant = await b.evaluate(() => Game.tick);
    await session.send('Page.setWebLifecycleState', { state: 'frozen' });
    await a.waitForFunction(tick => Game.tick >= tick + 35, avant, { timeout: 15000 });
    await session.send('Page.setWebLifecycleState', { state: 'active' });
    await b.waitForFunction(tick => Game.tick >= tick + 35, avant);
    // Coupure de la WebSocket, puis reprise automatique avec le jeton.
    await b.evaluate(() => Net.ws.close());
    await b.waitForFunction(() => !Autoritaire.ready);
    await b.screenshot({ path: path.join(dossier, 'connexion-interrompue-en.png') });
    await b.waitForFunction(() => Autoritaire.metrics.resumes >= 1 && Autoritaire.ready, { timeout: 15000 });
    const seq = await b.evaluate(() => { Autoritaire.state.seq -= 3; return Autoritaire.state.seq + 3; });
    await b.waitForFunction(n => Autoritaire.state.seq > n + 1, seq);
    await a.click('#pauseBtn');
    await Promise.all(pages.map(p => p.waitForFunction(() => Game.paused)));
    const empreinte = p => p.evaluate(async () => {
      const raw = Autoritaire.state.raw, enc = new TextEncoder();
      const parts = [enc.encode(JSON.stringify(raw.data)), ...Array.from(raw.arrays.values(), a => a.bytes)];
      const bytes = new Uint8Array(parts.reduce((n, b) => n + b.length, 0)); let pos = 0;
      for (const b of parts) { bytes.set(b, pos); pos += b.length; }
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return { seq: Autoritaire.state.seq, hash: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join(''),
        tick: Game.tick, appels: window.appelsRegles, metrics: Autoritaire.metrics };
    });
    let etats;
    for (let i = 0; i < 20; i++) { etats = await Promise.all(pages.map(empreinte)); if (etats[0].seq === etats[1].seq) break; }
    assert.equal(etats[0].seq, etats[1].seq); assert.equal(etats[0].hash, etats[1].hash);
    for (const e of etats) assert.deepEqual(e.appels, { init: 0, update: 0, runOrder: 0 });
    await a.screenshot({ path: path.join(dossier, 'partie-fr.png') });
    await b.screenshot({ path: path.join(dossier, 'partie-en.png') });
    // Le même client reste autonome en ouvrant index.html comme un fichier.
    const solo = await browsers[0].newPage(); solo.on('pageerror', e => erreurs.push('solo: ' + e.message));
    await solo.goto('file://' + path.resolve(__dirname, '../index.html'));
    await solo.evaluate(() => UI.launch({ name: 'Solo', banner: 0, mapType: 'normal', mapSize: 'petit', opponents: 4, difficulty: 'normal', seed: 123456 }));
    await solo.evaluate(() => { Game.placeWaitingHumans(); Game.phase = 'playing'; });
    await solo.waitForFunction(() => Game.tick >= 5);
    assert.equal(await solo.evaluate(() => Game.authoritative), false);
    await solo.screenshot({ path: path.join(dossier, 'solo-fichier.png') });
    assert.deepEqual(erreurs, []);
    const metrics = await (await fetch(s.url.replace('ws:', 'http:').replace('/ws', '/metrics'))).json();
    const resultat = { chromium: browsers[0].version(), etats, serveur: metrics, erreurs,
      verifications: ['deux navigateurs', 'FR/EN', 'lien d’invitation', 'alliance', 'don', 'attaque', 'gel/reprise', 'déconnexion/reconnexion', 'base perdue/résynchronisation', 'état exact', 'zéro simulation client', 'solo file://'] };
    fs.writeFileSync(path.join(dossier, 'resultat.json'), JSON.stringify(resultat, null, 2));
    console.log(JSON.stringify(resultat, null, 2));
  } finally { await Promise.all(browsers.map(b => b.close())); await s.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
