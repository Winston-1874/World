const { creerMoteur } = require('./moteur.cjs');
const { validOrder } = require('./ordres.cjs');

function creerSimulation(options) {
  let effets = null;
  const moteur = creerMoteur({ ...options, effet: (k, args) => {
    if (effets && effets.length < 32) effets.push({ k, args: args.slice(0, 2) });
  } });
  const G = moteur.Game, derniers = new Map(), historique = new Map();
  G.allianceRequests = new Map();
  G.emitEvent = e => {
    if (e.k === 'alliance') G.allianceRequests.set(e.from + ':' + e.to, { ...e, tick: G.tick, expires: G.tick + 600 });
  };
  function commande(slot, seq, o, langue = 'en') {
    const cle = slot + ':' + seq;
    if (historique.has(cle)) return historique.get(cle);
    const erreur = code => ({ slot, s: seq, code, result: langue === 'fr' ? 'Ordre refusé par le serveur.' : 'Order rejected by the server.', effets: [] });
    if (!Number.isSafeInteger(seq) || seq <= (derniers.get(slot) || 0)) return erreur('sequence');
    derniers.set(slot, seq);
    let r;
    const p = G.players[slot];
    const invalide = !p || !p.human || !validOrder(o) ||
      ['i', 'a', 'c', 'aim', 'src'].some(k => o[k] !== undefined && o[k] >= G.N) ||
      ['to', 'from', 'other', 'target'].some(k => o[k] !== undefined && o[k] >= G.players.length && ['ally', 'allyAnswer', 'betray', 'troops', 'gold', 'attack'].includes(o.k));
    // from est une case pour wall, un royaume pour allyAnswer.
    if (invalide || (o.k === 'wall' && o.from >= G.N)) r = erreur('invalid');
    else if (o.k === 'allyAnswer' && !G.allianceRequests.has(o.from + ':' + slot)) r = erreur('request');
    else {
      const human = G.human;
      effets = [];
      G.human = p;
      for (const q of G.players) q.isHuman = q.id === slot;
      moteur.langue(langue);
      try {
        const result = G.runOrder(slot, o);
        // Les retours d'armées contiennent des chemins volumineux inutiles aux callbacks UI.
        const simple = result && typeof result === 'object'
          ? Object.fromEntries(Object.entries(result).filter(([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v))) : result;
        r = { slot, s: seq, result: simple ?? null, effets };
        if (o.k === 'allyAnswer') G.allianceRequests.delete(o.from + ':' + slot);
      } finally {
        effets = null; G.human = human; moteur.langue('en');
        for (const q of G.players) q.isHuman = false;
      }
    }
    historique.set(cle, r);
    const propres = [...historique.keys()].filter(k => k.startsWith(slot + ':'));
    while (propres.length > 32) historique.delete(propres.shift());
    return r;
  }
  for (const p of G.players) p.isHuman = false;
  return { ...moteur, commande, derniers,
    resultats: () => [...historique.values()],
    avancer() {
      G.update();
      for (const [k, r] of G.allianceRequests) if (r.expires < G.tick || !G.players[r.to].human) G.allianceRequests.delete(k);
    },
  };
}
module.exports = { creerSimulation };
