const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// Une VM charge les règles ; l'isolation entre parties repose sur les processus enfants.
// Ni la VM ni ces processus ne constituent un bac à sable de sécurité système.
// Les règles sont chargées depuis les vrais scripts du client, dans leur ordre HTML.
function creerMoteur(options = {}) {
  const muet = () => {};
  const contexte = vm.createContext({
    console, TextEncoder, TextDecoder,
    localStorage: { getItem: () => options.langue || 'en' },
    document: { documentElement: { classList: { add: muet } }, addEventListener: muet },
    UI: { log: (...args) => options.effet?.('log', args), showEnd: muet, askAlliance: () => true },
    Render: { markDirty: muet, floatText: muet, towerShot: muet },
    Music: { sound: (...args) => options.effet?.('sound', args) },
  });
  const racine = path.resolve(__dirname, '..');
  const exclus = new Set(['js/icons.js', 'js/music.js', 'js/render.js', 'js/net.js', 'js/main.js', 'js/net-authoritative.js']);
  const html = fs.readFileSync(path.join(racine, 'index.html'), 'utf8');
  for (const [, script] of html.matchAll(/<script src="(js\/[^"?]+\.js)"><\/script>/g)) {
    if (exclus.has(script)) continue;
    vm.runInContext(fs.readFileSync(path.join(racine, script), 'utf8'), contexte, { filename: script });
  }
  const { Game, Replay } = vm.runInContext('({ Game, Replay })', contexte);
  Game.init({ online: true, seed: 123456, mapType: 'normal', mapSize: 'petit', difficulty: 'normal',
    humans: [{ name: 'Premier', banner: 0 }, { name: 'Second', banner: 1 }], opponents: 4,
    pacts: true, ...options });
  const noms = vm.runInContext('KINGDOMS', contexte);
  for (const p of Game.players) if (!p.human) p.nameKey = noms.indexOf(p.name);
  return { Game, Replay, langue: lang => vm.runInContext("LANG = " + JSON.stringify(lang === 'fr' ? 'fr' : 'en'), contexte) };
}

module.exports = { creerMoteur };
