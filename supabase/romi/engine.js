// foqs.romi - pravila igre (teče na strežniku v edge funkciji "romi"; kopija validate/arrange je tudi v app.js za predogled)
export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const parse = (id) => ({ r: id.slice(0, -1), s: id.slice(-1), id });
export const RV = (c) => RANKS.indexOf(typeof c === 'string' ? c : c.r) + 1;
export const isJ = (c) => (typeof c === 'string' ? c : c.r).startsWith('2');
export const val = (c) => { if (isJ(c)) return 25; const v = RV(c); if (v === 1) return 15; if (v >= 11) return 10; return 5; };

export function newDeck(rng = Math.random) {
  const d = []; for (const s of SUITS) for (const r of RANKS) d.push(r + s);
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

/* veljavnost kombinacije (rešitev B: mesto 2 v nizu obstaja, tam mora stati joker) */
export function validate(cards) {
  if (cards.length < 3) return null;
  const jok = cards.filter(isJ), nat = cards.filter((c) => !isJ(c));
  if (!nat.length) return { type: 'set', label: 'Set jokerjev', mode: 'jokers' };
  if (nat.every((c) => c.r === nat[0].r) && new Set(nat.map((c) => c.s)).size === nat.length && cards.length <= 4) return { type: 'set', label: 'Set ' + nat[0].r, mode: 'set' };
  if (nat.every((c) => c.s === nat[0].s) && new Set(nat.map((c) => c.r)).size === nat.length) {
    const tryRun = (vals) => { vals.sort((a, b) => a - b); const span = vals[vals.length - 1] - vals[0] + 1; const need = span - vals.length; return need <= jok.length && span + (jok.length - need) <= 13; };
    if (tryRun(nat.map(RV))) return { type: 'run', label: 'Niz ' + nat[0].s, mode: 'normal' };
    if (tryRun(nat.map((c) => (RV(c) === 1 ? 14 : RV(c))))) return { type: 'run', label: 'Niz ' + nat[0].s, mode: 'aceHigh' };
  }
  return null;
}

/* razporeditev: naravne karte po vrsti, joker na mesto, kjer je bil kliknjen; vrne [{c, as}] */
export function arrange(cards, v) {
  if (!v) return null;
  const jok = cards.filter(isJ), nat = cards.filter((c) => !isJ(c));
  if (v.type === 'set') { const rk = nat.length ? nat[0].r : '?'; return cards.map((c) => ({ c, as: isJ(c) ? { r: rk, s: '?' } : null })); }
  const suit = nat[0].s;
  const vv = (c) => { const r = RV(c); if (v.mode === 'aceHigh') return r === 1 ? 14 : r; return r; };
  const show = (x) => RANKS[(x === 14 ? 1 : x) - 1];
  const lo = 1, hi = v.mode === 'aceHigh' ? 14 : 13;
  const slots = new Map(); nat.forEach((c) => slots.set(vv(c), { c, as: null }));
  let min = Math.min(...slots.keys()), max = Math.max(...slots.keys());
  const put = (j, x) => slots.set(x, { c: j, as: { r: show(x), s: suit } });
  // 1) luknje v nizu so obvezne: zapolni jih najprej, vsako z jokerjem, ki je bil kliknjen najbliže tej luknji
  const gaps = []; for (let x = min + 1; x < max; x++) if (!slots.has(x)) gaps.push(x);
  const left = [...jok];
  const posOf = (c) => cards.indexOf(c);
  for (const g of gaps) {
    if (!left.length) break;
    const below = nat.filter((c) => vv(c) < g).sort((a, b) => vv(b) - vv(a))[0];
    const above = nat.filter((c) => vv(c) > g).sort((a, b) => vv(a) - vv(b))[0];
    const between = left.filter((j) => posOf(j) > posOf(below) && posOf(j) < posOf(above));
    const pick = between[0] || left.sort((a, b) => Math.abs(posOf(a) - posOf(above)) - Math.abs(posOf(b) - posOf(above)))[0];
    left.splice(left.indexOf(pick), 1); put(pick, g);
  }
  // 2) preostali jokerji: pred prvo naravno karto = navzdol, sicer navzgor; če ni prostora, na drugo stran
  const firstNat = Math.min(...nat.map(posOf));
  for (const j of left) {
    const wantLo = posOf(j) < firstNat;
    if (wantLo && min - 1 >= lo) { min--; put(j, min); }
    else if (!wantLo && max + 1 <= hi) { max++; put(j, max); }
    else if (max + 1 <= hi) { max++; put(j, max); }
    else { min--; put(j, min); }
  }
  return [...slots.keys()].sort((a, b) => a - b).map((k) => slots.get(k));
}

/* možnosti dodajanja karte v kombinacijo na mizi */
export function swapIndex(meld, card) {
  if (isJ(card)) return -1;
  return meld.cards.findIndex((x) => isJ(x.c) && x.as && x.as.r === card.r && (x.as.s === card.s || (x.as.s === '?' && !meld.cards.some((y) => !isJ(y.c) && y.c.s === card.s))));
}
export function addOptions(meld, card) {
  const si = swapIndex(meld, card); if (si >= 0) return { swap: si };
  const base = meld.cards.map((x) => x.c); const test = validate([...base, card]); if (!test) return null;
  if (test.type === 'set' || !isJ(card)) return { test, lo: null, hi: null, auto: arrange([...base, card], test) };
  const lo = arrange([card, ...base], test), hi = arrange([...base, card], test);
  const loOk = lo[0].c.id === card.id, hiOk = hi[hi.length - 1].c.id === card.id;
  return { test, lo: loOk ? { arr: lo, as: lo.find((x) => x.c.id === card.id).as } : null, hi: hiOk ? { arr: hi, as: hi.find((x) => x.c.id === card.id).as } : null, auto: hiOk ? hi : lo };
}

/* vrednost karte na mizi (joker = karta, ki jo nadomešča; set jokerjev = 25) */
export function tableVal(x) {
  if (!isJ(x.c)) return val(x.c);
  if (!x.as || x.as.r === '?') return 25;
  return val({ r: x.as.r, s: x.as.s === '?' ? '♠' : x.as.s });
}

/* ================= cekini ================= */
// dobre poteze med igro (štejejo samo ljudem, izplačajo se ob koncu igre)
export const COIN_EV = { out: { n: 10, label: 'Šel si ven' }, handOut: { n: 25, label: 'Ven naenkrat, iz roke' }, swap: { n: 3, label: 'Zamenjava jokerja' }, set4: { n: 5, label: 'Set štirih enakih' } };
function ev(p, k) { if (!p || p.bot) return; p.ev = p.ev || {}; p.ev[k] = (p.ev[k] || 0) + 1; }
export function evCoins(p) { return Object.entries(p.ev || {}).reduce((a, [k, n]) => a + (COIN_EV[k] ? COIN_EV[k].n * n : 0), 0); }
// nagrade ob koncu igre (izračun je enak na strežniku in v testnem načinu; strežnik doda še dnevno omejitev za igre z boti)
export function computeAwards(g) {
  if (g.status !== 'finished' || g.abandoned || g.campaign || !(g.finishedNaturally || g.daily)) return null;
  const humans = g.players.filter((p) => !p.bot && !p.left);
  const solo = !g.daily && humans.length === 1;
  const order = [...g.players].sort((a, b) => b.score - a.score);
  const out = {};
  for (const p of humans) {
    const place = order.findIndex((x) => x.seat === p.seat);
    const parts = [];
    if (g.daily) { parts.push({ label: 'Dnevni izziv odigran', n: 20 }); if (place === 0) parts.push({ label: 'Premagal si bote', n: 30 }); }
    else { parts.push({ label: 'Odigrana igra', n: 20 }); const pb = [60, 30, 15][place]; if (pb) parts.push({ label: (place + 1) + '. mesto', n: pb }); }
    for (const [k, n] of Object.entries(p.ev || {})) if (COIN_EV[k] && n) parts.push({ label: COIN_EV[k].label + (n > 1 ? ' ×' + n : ''), n: COIN_EV[k].n * n });
    let total = parts.reduce((a, x) => a + x.n, 0);
    if (solo) total = Math.floor(total / 2);
    out[p.seat] = { total, parts, solo, place };
  }
  return out;
}
/* ================= kampanja ================= */
export const CAMPAIGN = {
  chapter: 'Gostilna pri Joži',
  levels: [
    { n: 1, title: 'Prvi obisk', bots: [['Micka', 1]], goal: 150, coins: 25 },
    { n: 2, title: 'Kavica s Francijem', bots: [['Franci', 1]], goal: 150, coins: 30 },
    { n: 3, title: 'Babice na obisku', bots: [['Micka', 1], ['Pepca', 1]], goal: 150, coins: 35 },
    { n: 4, title: 'Upokojeni učitelj', bots: [['Učitelj Rudi', 2]], goal: 150, coins: 40 },
    { n: 5, title: 'Kvartopirca', bots: [['Rudi', 2], ['Stanka', 2]], goal: 150, coins: 45 },
    { n: 6, title: 'Nedeljska partija', bots: [['Stanka', 2], ['Tone', 2]], goal: 150, coins: 50 },
    { n: 7, title: 'Stari maček', bots: [['Maček Ivo', 3]], goal: 150, coins: 55 },
    { n: 8, title: 'Gostilniška mojstra', bots: [['Ivo', 3], ['Vida', 3]], goal: 150, coins: 60 },
    { n: 9, title: 'Polna miza', bots: [['Ivo', 3], ['Vida', 3], ['Tone', 2]], goal: 150, coins: 70 },
    { n: 10, title: 'Šef: Joža', bots: [['Joža', 4], ['Ivo', 3]], goal: 200, coins: 150, boss: true, unlock: 'back_joza' },
  ],
};
export const BOT_LEVELS = { 1: 'začetnik', 2: 'rekreativec', 3: 'gostilniški mojster', 4: 'profesionalec' };
// rezultat nivoja: zmaga = 1 zvezdica, zmaga za 50+ = 2, za 100+ = 3
export function campaignResult(g) {
  if (!g.campaign || g.status !== 'finished' || g.abandoned || !g.finishedNaturally) return null;
  const me = g.players.find((p) => !p.bot && !p.left); if (!me) return null;
  const best = Math.max(...g.players.filter((p) => p.seat !== me.seat).map((p) => p.score));
  const won = g.winner === me.seat; const margin = me.score - best;
  return { seat: me.seat, won, margin, stars: won ? (margin >= 100 ? 3 : margin >= 50 ? 2 : 1) : 0, level: g.campaign };
}
// namig: veljavna kombinacija v roki ali karta, ki jo lahko dodaš
export function findHint(g, seat) {
  const p = g.players[seat]; if (!p) return null;
  const keep = g.turnsInRound < g.players.length ? 2 : 1;
  const L = findLay(p.hand, true, p.hand.length - keep); if (L) return { type: 'lay', ids: L.map((c) => c.id) };
  if (p.opened && p.hand.length - 1 >= keep) for (const id of p.hand) for (let mi = 0; mi < g.melds.length; mi++) { if (addOptions(meldOf(g.melds[mi]), parse(id))) return { type: 'add', ids: [id], meld: mi }; }
  return null;
}
const meldOf = (m) => ({ cards: m.cards.map((x) => ({ c: parse(x.c), by: x.by, as: x.as })) });
// najde veljavno kombinacijo (najprej trojko, nato jo razširi), največ maxTake kart
function findLay(hand, allowJ, maxTake) {
  if (maxTake < 3) return null;
  const h = hand.map(parse); const n = h.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) {
    const cs = [h[a], h[b], h[c]]; if (!allowJ && cs.some(isJ)) continue; if (!validate(cs)) continue;
    let cur = cs; for (const x of h) { if (cur.length >= maxTake) break; if (cur.includes(x) || (!allowJ && isJ(x))) continue; const t = [...cur, x]; if (validate(t)) cur = t; }
    return cur;
  }
  return null;
}
// koliko ji pomagajo ostale karte v roki (za izbiro, kaj zavreči)
function useful(id, hand) {
  if (isJ(id)) return 99; const c = parse(id); let u = 0;
  for (const o of hand) { if (o === id) continue; if (isJ(o)) { u += 0.5; continue; } const q = parse(o);
    if (q.r === c.r && q.s !== c.s) u += 2;
    else if (q.s === c.s) { const hi = (x) => (RV(x) === 1 ? 14 : RV(x)); const d = Math.min(Math.abs(RV(q) - RV(c)), Math.abs(hi(q) - hi(c))); if (d === 1) u += 2; else if (d === 2) u += 1; } }
  return u;
}
function rngFrom(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function seedOf(str) { let h = 2166136261; for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

/* ================= stanje igre ================= */
export function newGame(players, turnTime, goal) {
  return {
    round: 0, deck: [], discard: [], melds: [], rounds: [],
    players: players.map((p, i) => ({ id: p.user_id, name: p.name, seat: i, hand: [], opened: false, score: 0, ready: false, bot: !!p.is_bot, lvl: p.lvl || (p.is_bot ? 2 : undefined) })),
    turn: 0, phase: 'lobby', turnStarted: 0, paused: false, pausedAt: 0, turnTime, goal,
    turnsInRound: 0, starter: 0, drawnTop: null, log: [], status: 'playing', winner: null, roundEnd: null, roundStartedAt: 0,
  };
}
export function startRound(g, now) {
  g.round++; g.deck = newDeck(g.seed ? rngFrom(g.seed + g.round) : Math.random); g.melds = []; g.roundEnd = null; g.turnsInRound = 0; g.drawnTop = null;
  g.players.forEach((p) => { p.hand = []; p.opened = false; p.ready = false; });
  for (let i = 0; i < 7; i++) g.players.forEach((p) => p.hand.push(g.deck.pop()));
  g.discard = [g.deck.pop()];
  g.turn = g.starter; g.phase = 'draw'; g.turnStarted = now; g.paused = false; g.roundStartedAt = now; g.turnOpened = g.players[g.turn].opened;
  g.log.push({ t: now, m: 'Runda ' + g.round + ' se začne. Začne ' + g.players[g.turn].name + '.' });
}
function reshuffleIfEmpty(g) {
  if (g.deck.length) return false;
  const top = g.discard.pop(); g.deck = g.discard; g.discard = top ? [top] : [];
  for (let i = g.deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [g.deck[i], g.deck[j]] = [g.deck[j], g.deck[i]]; }
  g.log.push({ t: Date.now(), m: 'Kup je prazen, odložene karte so premešane.' });
  return true;
}
export function cur(g) { return g.players[g.turn]; }
const err = (m) => { const e = new Error(m); e.user = true; throw e; };

export function act(g, seat, a, now) {
  if (g.status !== 'playing') err('Igra je končana.');
  if (a.type === 'ready') return ready(g, seat, now);
  if (g.phase === 'roundEnd') err('Runda je končana, pritisni Ready.');
  if (g.paused) err('Igra je na pavzi.');
  if (seat !== g.turn) err('Nisi na potezi.');
  const p = cur(g); p.idle = 0;
  const hand = (id) => { const c = p.hand.find((x) => x === id); if (!c) err('Te karte nimaš v roki.'); return parse(c); };
  const remove = (id) => { p.hand.splice(p.hand.indexOf(id), 1); };
  switch (a.type) {
    case 'draw': {
      if (g.phase !== 'draw') err('Karto si že potegnil.');
      if (a.from === 'deck') { reshuffleIfEmpty(g); const c = g.deck.pop(); if (!c) err('Ni kart.'); p.hand.push(c); g.log.push({ t: now, m: p.name + ' je potegnil s kupa.' }); }
      else if (a.from === 'top') { const c = g.discard.pop(); if (!c) err('Kupček je prazen.'); p.hand.push(c); g.drawnTop = c; g.took = g.took || {}; g.took[seat] = [...(g.took[seat] || []), c].slice(-6); g.log.push({ t: now, m: p.name + ' je vzel ' + c + ' z odloženih.' }); }
      else if (a.from === 'all') { if (!g.discard.length) err('Kupček je prazen.'); const n = g.discard.length; p.hand.push(...g.discard); g.discard = []; g.log.push({ t: now, m: p.name + ' je vzel cel kupček (' + n + ').' }); }
      else err('Neznan vir.');
      g.phase = 'play'; return;
    }
    case 'lay': {
      if (g.phase !== 'play') err('Najprej potegni karto.');
      const ids = a.ids || []; if (new Set(ids).size !== ids.length) err('Podvojene karte.');
      const cs = ids.map(hand); const v = validate(cs); if (!v) err('Izbor ni veljavna kombinacija.');
      const keep = g.turnsInRound < g.players.length ? 2 : 1;
      if (p.hand.length - cs.length < keep) err(keep === 2 ? 'V prvem krogu ne moreš iti ven: obdrži vsaj 2 karti.' : 'Eno karto moraš obdržati za zavreči.');
      g.melds.push({ owner: seat, cards: arrange(cs, v).map((x) => ({ c: x.c.id, by: seat, as: x.as })) });
      ids.forEach(remove); p.opened = true; ev(p, 'lay'); if (v.type === 'run' && cs.length >= 5) ev(p, 'run5'); if (v.mode === 'set' && cs.length === 4) ev(p, 'set4'); g.log.push({ t: now, m: p.name + ' je položil: ' + v.label + '.' }); return;
    }
    case 'add': {
      if (g.phase !== 'play') err('Najprej potegni karto.');
      if (!p.opened) err('Najprej moraš odpreti (položiti svojo kombinacijo).');
      const m = g.melds[a.meld]; if (!m) err('Ni take kombinacije.');
      const card = hand(a.id);
      const mm = { cards: m.cards.map((x) => ({ c: parse(x.c), by: x.by, as: x.as })) };
      const opt = addOptions(mm, card); if (!opt) err('Ta karta ne paše v to kombinacijo.');
      if (opt.swap !== undefined) {
        const old = m.cards[opt.swap]; const joker = old.c;
        m.cards[opt.swap] = { c: card.id, by: old.by, as: null }; remove(card.id); p.hand.push(joker); ev(p, 'swap');
        g.log.push({ t: now, m: p.name + ' je s ' + card.id + ' zamenjal jokerja pri ' + g.players[m.owner].name + '.' }); return;
      }
      const keepA = g.turnsInRound < g.players.length ? 2 : 1;
      if (p.hand.length - 1 < keepA) err(keepA === 2 ? 'V prvem krogu ne moreš iti ven: obdrži vsaj 2 karti.' : 'Eno karto moraš obdržati za zavreči.');
      const arr = a.side === 'lo' && opt.lo ? opt.lo.arr : a.side === 'hi' && opt.hi ? opt.hi.arr : opt.auto;
      m.cards = arr.map((x) => { const o = m.cards.find((y) => y.c === x.c.id); return { c: x.c.id, by: o ? o.by : seat, as: x.as }; });
      remove(card.id); if (m.owner !== seat) ev(p, 'add'); if (opt.test && opt.test.mode === 'set' && m.cards.length === 4) ev(p, 'set4'); g.log.push({ t: now, m: p.name + ' je dodal ' + card.id + ' k ' + g.players[m.owner].name + '.' }); return;
    }
    case 'discard': {
      if (g.phase !== 'play') err('Najprej potegni karto.');
      const card = hand(a.id);
      const onlyJokers = p.hand.every((c) => isJ(c));
      if (isJ(card) && !onlyJokers) err('Jokerja (dvojke) ne moreš zavreči.');
      if (p.hand.length === 1 && g.turnsInRound < g.players.length) err('V prvem krogu ne moreš zaključiti runde.');
      remove(card.id); g.discard.push(card.id); g.log.push({ t: now, m: p.name + ' je zavrgel karto.' });
      if (!p.hand.length) return endRound(g, seat, now);
      return nextTurn(g, now);
    }
    default: err('Neznana akcija.');
  }
}
function nextTurn(g, now) {
  g.turnsInRound++; g.turn = (g.turn + 1) % g.players.length; g.phase = 'draw'; g.turnStarted = now; g.drawnTop = null; g.turnOpened = g.players[g.turn].opened;
}
export function autoMove(g, now) {
  const p = cur(g); if (!p.bot) p.idle = (p.idle || 0) + 1;
  if (g.phase === 'draw') { reshuffleIfEmpty(g); const c = g.deck.pop(); if (c) p.hand.push(c); g.phase = 'play'; }
  const nonJ = p.hand.filter((c) => !isJ(c));
  const pool = nonJ.length ? nonJ : p.hand;
  const cantFinish = p.hand.length === 1 && g.turnsInRound < g.players.length;
  const d = pool[Math.floor(Math.random() * pool.length)];
  if (cantFinish) { g.log.push({ t: now, m: 'Čas je potekel, ' + p.name + ' je preskočil potezo.' }); return nextTurn(g, now); }
  p.hand.splice(p.hand.indexOf(d), 1); g.discard.push(d);
  g.log.push({ t: now, m: 'Čas je potekel, app je za ' + p.name + ' zavrgel karto.' });
  if (!p.hand.length) return endRound(g, g.turn, now);
  nextTurn(g, now);
}
export function checkTimeout(g, now) {
  if (g.status !== 'playing' || g.phase === 'roundEnd' || g.phase === 'lobby' || g.paused) return false;
  if (now - g.turnStarted >= g.turnTime * 1000) { autoMove(g, now); checkAbandon(g, now); return true; }
  return false;
}
/* igralec, ki 3 poteze zapored ne odigra, velja za odsotnega; ko ni več nobenega prisotnega človeka, se igra konča (ne šteje v lestvico) */
export function checkAbandon(g, now) {
  if (g.status !== 'playing') return false;
  const humans = g.players.filter((p) => !p.bot && !p.left);
  if (humans.length && humans.some((p) => (p.idle || 0) < 3)) return false;
  g.status = 'finished'; g.abandoned = true; g.log.push({ t: now, m: 'Igra je končana, ker ni več aktivnih igralcev.' });
  return true;
}
/* igralec zapusti igro: namesto njega igra bot; če ne ostane noben človek, se igra konča */
export function quit(g, seat, now) {
  const p = g.players[seat]; if (!p || p.left) return;
  p.left = true; p.bot = true; p.ready = true; p.name = p.name + ' (bot)';
  g.log.push({ t: now, m: p.name.replace(' (bot)', '') + ' je zapustil igro, namesto njega igra bot.' });
  if (g.phase === 'roundEnd' && g.players.every((x) => x.ready)) startRound(g, now);
  checkAbandon(g, now);
}
function endRound(g, winnerSeat, now) {
  const wp = g.players[winnerSeat]; ev(wp, 'out'); if (g.turnOpened === false && g.turn === winnerSeat) ev(wp, 'handOut');
  const rows = g.players.map((p) => {
    const tc = g.melds.flatMap((m) => m.cards).filter((x) => x.by === p.seat);
    const table = tc.reduce((a, x) => a + tableVal({ c: parse(x.c), as: x.as }), 0);
    const hand = p.hand.reduce((a, c) => a + val(parse(c)), 0);
    return { seat: p.seat, table, hand, sum: table - hand, tableCards: tc.map((x) => x.c), handCards: [...p.hand] };
  });
  rows.forEach((r) => { g.players[r.seat].score += r.sum; });
  g.rounds.push(rows.map((r) => r.sum));
  g.roundEnd = { round: g.round, winner: winnerSeat, rows, at: now };
  g.phase = 'roundEnd'; g.starter = winnerSeat; g.players.forEach((p) => (p.ready = !!p.bot));
  g.log.push({ t: now, m: g.players[winnerSeat].name + ' je šel ven. Konec runde ' + g.round + '.' });
  const over = g.players.filter((p) => p.score >= g.goal);
  if (over.length) { const w = over.sort((a, b) => b.score - a.score)[0]; g.status = 'finished'; g.winner = w.seat; g.finishedNaturally = true; g.log.push({ t: now, m: w.name + ' je zmagal igro s ' + w.score + ' točkami!' }); }
  else if (g.maxRounds && g.rounds.length >= g.maxRounds) { const w = [...g.players].sort((a, b) => b.score - a.score)[0]; g.status = 'finished'; g.winner = w.seat; g.log.push({ t: now, m: 'Dnevni izziv je končan. Največ točk: ' + w.name + ' (' + w.score + ').' }); }
}
function ready(g, seat, now) {
  if (g.phase !== 'roundEnd') err('Runda še teče.');
  g.players[seat].ready = true;
  if (g.players.every((p) => p.ready)) startRound(g, now);
}

/* pogled za enega igralca (brez tujih kart) */
export function view(g, seat, now) {
  const me = g.players.find((p) => p.seat === seat);
  return {
    round: g.round, phase: g.phase, status: g.status, winner: g.winner, turn: g.turn, turnStarted: g.turnStarted, turnTime: g.turnTime, goal: g.goal,
    paused: g.paused, now, deckCount: g.deck.length, discard: g.discard.slice(-1), discardCount: g.discard.length, drawnTop: g.drawnTop,
    melds: g.melds, rounds: g.rounds, roundEnd: g.roundEnd, roundStartedAt: g.roundStartedAt, log: g.log.slice(-12),
    turnsInRound: g.turnsInRound, playersCount: g.players.length,
    players: g.players.map((p) => ({ seat: p.seat, id: p.id, name: p.name, handCount: p.hand.length, opened: p.opened, score: p.score, ready: p.ready, bot: !!p.bot, lvl: p.bot ? p.lvl || 2 : null, left: !!p.left, idle: p.idle || 0 })),
    abandoned: !!g.abandoned, daily: g.daily || null, campaign: g.campaign || null, noTimer: !!g.noTimer, hint: g.hint || null,
    me: me ? { seat: me.seat, hand: me.hand, opened: me.opened, ev: me.ev || {}, coins: evCoins(me), award: (g.awards && g.awards[me.seat]) || null } : null,
  };
}

/* ===== bot: stopnje 1 (začetnik) do 4 (profesionalec); odigra eno potezo, če je minilo vsaj 1,2 s ===== */
export function botStep(g, now) {
  if (g.status !== 'playing' || g.phase === 'roundEnd' || g.paused) return false;
  const p = cur(g); if (!p.bot || now - g.turnStarted < 1200) return false;
  const lvl = p.lvl || 2; const seat = g.turn;
  const keep = () => (g.turnsInRound < g.players.length ? 2 : 1);
  try {
    if (g.phase === 'draw') {
      const top = g.discard[g.discard.length - 1];
      let takeTop = false;
      if (lvl >= 2 && top && !isJ(top)) { const L = findLay([...p.hand, top], lvl < 3, p.hand.length + 1 - keep()); takeTop = !!(L && L.some((c) => c.id === top)); }
      act(g, seat, { type: 'draw', from: takeTop ? 'top' : 'deck' }, now);
    }
    for (let guard = 0; guard < 12; guard++) {
      let did = false;
      // 1) položi kombinacije (mojster jokerje varčuje za konec)
      let L = findLay(p.hand, lvl < 3, p.hand.length - keep());
      if (!L && lvl >= 3 && p.hand.length <= 5) L = findLay(p.hand, true, p.hand.length - keep());
      if (L) { act(g, seat, { type: 'lay', ids: L.map((c) => c.id) }, now); did = true; continue; }
      if (!p.opened) break;
      // 2) zamenjaj jokerja na mizi (mojster in profesionalec)
      if (lvl >= 3) for (const id of p.hand.filter((c) => !isJ(c))) { for (let mi = 0; mi < g.melds.length && !did; mi++) { const o = addOptions(meldOf(g.melds[mi]), parse(id)); if (o && o.swap !== undefined) { try { act(g, seat, { type: 'add', meld: mi, id }, now); did = true; } catch (_e) { /* ni šlo */ } } } if (did) break; }
      if (did) continue;
      // 3) dodaj karte k obstoječim kombinacijam
      if (p.hand.length - 1 >= keep()) { const order = [...p.hand].sort((a, b) => (isJ(a) ? 1 : 0) - (isJ(b) ? 1 : 0));
        for (const id of order) { if (isJ(id) && lvl >= 3 && p.hand.length > 3) continue; for (let mi = 0; mi < g.melds.length && !did; mi++) { const o = addOptions(meldOf(g.melds[mi]), parse(id)); if (o && o.swap === undefined) { try { act(g, seat, { type: 'add', meld: mi, id }, now); did = true; } catch (_e) { /* ni šlo */ } } } if (did) break; } }
      if (!did) break;
    }
    const cantFinish = p.hand.length === 1 && g.turnsInRound < g.players.length;
    if (cantFinish) { g.log.push({ t: now, m: p.name + ' je preskočil potezo (prvi krog).' }); g.turnsInRound++; g.turn = (g.turn + 1) % g.players.length; g.phase = 'draw'; g.turnStarted = now; g.drawnTop = null; g.turnOpened = g.players[g.turn].opened; return true; }
    // 4) zavrzi: začetnik naključno, ostali najmanj uporabno in najdražjo; profesionalec ne podarja kart
    const nonJ = p.hand.filter((c) => !isJ(c)); let pool = nonJ.length ? nonJ : [...p.hand];
    let pick;
    if (lvl <= 1) pick = pool[Math.floor(Math.random() * pool.length)];
    else {
      if (lvl >= 4) {
        const fitsTable = (id) => g.melds.some((m) => addOptions(meldOf(m), parse(id)));
        const took = Object.entries(g.took || {}).filter(([st]) => +st !== seat && !g.players[+st].bot).flatMap(([, v]) => v).map(parse);
        const helpsHuman = (id) => { const c = parse(id); return took.some((t) => t.r === c.r || (t.s === c.s && Math.abs(RV(t) - RV(c)) <= 2)); };
        const safe = pool.filter((id) => !fitsTable(id) && !helpsHuman(id)); if (safe.length) pool = safe;
      }
      pick = [...pool].sort((a, b) => useful(a, p.hand) - useful(b, p.hand) || val(parse(b)) - val(parse(a)))[0];
    }
    act(g, seat, { type: 'discard', id: pick }, now);
  } catch (e) { g.log.push({ t: now, m: 'Bot ' + p.name + ' napaka: ' + e.message }); autoMove(g, now); }
  return true;
}
