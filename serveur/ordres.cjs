// Validation de forme commune aux protocoles 1 et 2.
function validOrder(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  const entier = (v, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= min && v <= max;
  const caseCarte = v => entier(v, 0, 999999); // plus grande carte multijoueur : Europe, 1000 × 1000
  const royaume = v => entier(v, 0, 45); // 16 humains et au plus 30 bots
  const montant = v => Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;
  const optionCase = v => v === undefined || v === -1 || caseCarte(v);
  switch (o.k) {
    case 'spawn': case 'crossing': case 'bridge': return caseCarte(o.i);
    case 'build': return caseCarte(o.i) && entier(o.type, 1, 8);
    case 'upgrade': case 'cancelWorks': case 'fortify': case 'demolish': case 'repatriate':
    case 'abandon': case 'crusade': case 'levy': return caseCarte(o.a);
    case 'attack': return (o.target === -1 || royaume(o.target)) && montant(o.troops) && optionCase(o.aim) && optionCase(o.src);
    case 'defend': return entier(o.attack) && montant(o.troops);
    case 'cancelAttack': case 'recallDefense': return entier(o.attack);
    case 'recall': return entier(o.id);
    case 'link': return caseCarte(o.c) && montant(o.troops);
    case 'expedition': case 'viking': return caseCarte(o.i) && montant(o.troops);
    case 'reinforce': return caseCarte(o.a) && montant(o.troops);
    case 'buyViking': return true;
    case 'relic': return entier(o.id) && montant(o.troops);
    case 'relicChase': case 'relicReinforce': return entier(o.run) && montant(o.troops);
    case 'relicRecall': return entier(o.run);
    case 'wall': return caseCarte(o.c) && caseCarte(o.i) && optionCase(o.from);
    case 'trade': return caseCarte(o.a) && caseCarte(o.i);
    case 'ally': return royaume(o.to);
    case 'allyAnswer': return royaume(o.from) && typeof o.yes === 'boolean';
    case 'betray': return royaume(o.other);
    case 'troops': return royaume(o.to) && montant(o.n);
    case 'gold': return royaume(o.to) && montant(o.g);
    default: return false; // ordres internes et scénarios solo exclus
  }
}

module.exports = { validOrder };
