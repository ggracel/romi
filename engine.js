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
    if (nat.some((c) => RV(c) === 1) && tryRun(nat.map((c) => { const v = RV(c); return v >= 11 ? v - 13 : v; }))) return { type: 'run', label: 'Niz ' + nat[0].s + ' (čez rob)', mode: 'wrap' };
  }
  return null;
}

/* razporeditev: naravne karte po vrsti, joker na mesto, kjer je bil kliknjen; vrne [{c, as}] */
export function arrange(cards, v) {
  if (!v) return null;
  const jok = cards.filter(isJ), nat = cards.filter((c) => !isJ(c));
  if (v.type === 'set') { const rk = nat.length ? nat[0].r : '?'; return cards.map((c) => ({ c, as: isJ(c) ? { r: rk, s: '?' } : null })); }
  const suit = nat[0].s;
  const vv = (c) => { const r = RV(c); if (v.mode === 'aceHigh') return r === 1 ? 14 : r; if (v.mode === 'wrap') return r >= 11 ? r - 13 : r; return r; };
  const show = (x) => { let r = x; if (v.mode === 'wrap' && r <= 0) r += 13; if (r === 14) r = 1; return RANKS[r - 1]; };
  const lo = v.mode === 'wrap' ? -2 : 1, hi = v.mode === 'wrap' ? 13 : (v.mode === 'aceHigh' ? 14 : 13);
  const slots = new Map(); nat.forEach((c) => slots.set(vv(c), { c, as: null }));
  let min = Math.min(...slots.keys()), max = Math.max(...slots.keys());
  const gaps = () => { const g = []; for (let x = min + 1; x < max; x++) if (!slots.has(x)) g.push(x); return g; };
  for (const j of jok) {
    const i = cards.indexOf(j); let prev = null, next = null;
    for (let k = i - 1; k >= 0; k--) if (!isJ(cards[k])) { prev = cards[k]; break; }
    for (let k = i + 1; k < cards.length; k++) if (!isJ(cards[k])) { next = cards[k]; break; }
    let placed = false;
    const put = (x) => { slots.set(x, { c: j, as: { r: show(x), s: suit } }); placed = true; };
    if (prev && next) { const a = vv(prev), b = vv(next); const g = gaps().filter((x) => x > Math.min(a, b) && x < Math.max(a, b)); if (g.length) put(g[0]); }
    if (!placed && !prev && min - 1 >= lo) { min--; put(min); }
    if (!placed && !next && max + 1 <= hi) { max++; put(max); }
    if (!placed) { const g = gaps(); if (g.length) put(g[0]); }
    if (!placed) { if (max + 1 <= hi) { max++; put(max); } else { min--; put(min); } }
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

/* ================= stanje igre ================= */
export function newGame(players, turnTime, goal) {
  return {
    round: 0, deck: [], discard: [], melds: [], rounds: [],
    players: players.map((p, i) => ({ id: p.user_id, name: p.name, seat: i, hand: [], opened: false, score: 0, ready: false })),
    turn: 0, phase: 'lobby', turnStarted: 0, paused: false, pausedAt: 0, turnTime, goal,
    turnsInRound: 0, starter: 0, drawnTop: null, log: [], status: 'playing', winner: null, roundEnd: null, roundStartedAt: 0,
  };
}
export function startRound(g, now) {
  g.round++; g.deck = newDeck(); g.melds = []; g.roundEnd = null; g.turnsInRound = 0; g.drawnTop = null;
  g.players.forEach((p) => { p.hand = []; p.opened = false; p.ready = false; });
  for (let i = 0; i < 6; i++) g.players.forEach((p) => p.hand.push(g.deck.pop()));
  g.discard = [g.deck.pop()];
  g.turn = g.starter; g.phase = 'draw'; g.turnStarted = now; g.paused = false; g.roundStartedAt = now;
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
  const p = cur(g);
  const hand = (id) => { const c = p.hand.find((x) => x === id); if (!c) err('Te karte nimaš v roki.'); return parse(c); };
  const remove = (id) => { p.hand.splice(p.hand.indexOf(id), 1); };
  switch (a.type) {
    case 'draw': {
      if (g.phase !== 'draw') err('Karto si že potegnil.');
      if (a.from === 'deck') { reshuffleIfEmpty(g); const c = g.deck.pop(); if (!c) err('Ni kart.'); p.hand.push(c); g.log.push({ t: now, m: p.name + ' je potegnil s kupa.' }); }
      else if (a.from === 'top') { const c = g.discard.pop(); if (!c) err('Kupček je prazen.'); p.hand.push(c); g.drawnTop = c; g.log.push({ t: now, m: p.name + ' je vzel ' + c + ' z odloženih.' }); }
      else if (a.from === 'all') { if (!g.discard.length) err('Kupček je prazen.'); const n = g.discard.length; p.hand.push(...g.discard); g.discard = []; g.log.push({ t: now, m: p.name + ' je vzel cel kupček (' + n + ').' }); }
      else err('Neznan vir.');
      g.phase = 'play'; return;
    }
    case 'lay': {
      if (g.phase !== 'play') err('Najprej potegni karto.');
      const ids = a.ids || []; if (new Set(ids).size !== ids.length) err('Podvojene karte.');
      const cs = ids.map(hand); const v = validate(cs); if (!v) err('Izbor ni veljavna kombinacija.');
      if (p.hand.length - cs.length < 1) err('Eno karto moraš obdržati za zavreči.');
      g.melds.push({ owner: seat, cards: arrange(cs, v).map((x) => ({ c: x.c.id, by: seat, as: x.as })) });
      ids.forEach(remove); p.opened = true; g.log.push({ t: now, m: p.name + ' je položil: ' + v.label + '.' }); return;
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
        m.cards[opt.swap] = { c: card.id, by: old.by, as: null }; remove(card.id); p.hand.push(joker);
        g.log.push({ t: now, m: p.name + ' je s ' + card.id + ' zamenjal jokerja pri ' + g.players[m.owner].name + '.' }); return;
      }
      if (p.hand.length - 1 < 1) err('Eno karto moraš obdržati za zavreči.');
      const arr = a.side === 'lo' && opt.lo ? opt.lo.arr : a.side === 'hi' && opt.hi ? opt.hi.arr : opt.auto;
      m.cards = arr.map((x) => { const o = m.cards.find((y) => y.c === x.c.id); return { c: x.c.id, by: o ? o.by : seat, as: x.as }; });
      remove(card.id); g.log.push({ t: now, m: p.name + ' je dodal ' + card.id + ' k ' + g.players[m.owner].name + '.' }); return;
    }
    case 'discard': {
      if (g.phase !== 'play') err('Najprej potegni karto.');
      const card = hand(a.id);
      const onlyJokers = p.hand.every((c) => isJ(c));
      if (isJ(card) && !onlyJokers) err('Jokerja (dvojke) ne moreš zavreči.');
      if (p.hand.length === 1 && g.turnsInRound < g.players.length) err('V prvem krogu ne moreš zaključiti runde.');
      remove(card.id); g.discard.push(card.id); g.log.push({ t: now, m: p.name + ' je zavrgel ' + card.id + '.' });
      if (!p.hand.length) return endRound(g, seat, now);
      return nextTurn(g, now);
    }
    default: err('Neznana akcija.');
  }
}
function nextTurn(g, now) {
  g.turnsInRound++; g.turn = (g.turn + 1) % g.players.length; g.phase = 'draw'; g.turnStarted = now; g.drawnTop = null;
}
export function autoMove(g, now) {
  const p = cur(g);
  if (g.phase === 'draw') { reshuffleIfEmpty(g); const c = g.deck.pop(); if (c) p.hand.push(c); g.phase = 'play'; }
  const nonJ = p.hand.filter((c) => !isJ(c));
  const pool = nonJ.length ? nonJ : p.hand;
  const cantFinish = p.hand.length === 1 && g.turnsInRound < g.players.length;
  const d = pool[Math.floor(Math.random() * pool.length)];
  if (cantFinish) { g.log.push({ t: now, m: 'Čas je potekel, ' + p.name + ' je preskočil potezo.' }); return nextTurn(g, now); }
  p.hand.splice(p.hand.indexOf(d), 1); g.discard.push(d);
  g.log.push({ t: now, m: 'Čas je potekel, app je za ' + p.name + ' zavrgel ' + d + '.' });
  if (!p.hand.length) return endRound(g, g.turn, now);
  nextTurn(g, now);
}
export function checkTimeout(g, now) {
  if (g.status !== 'playing' || g.phase === 'roundEnd' || g.phase === 'lobby' || g.paused) return false;
  if (now - g.turnStarted >= g.turnTime * 1000) { autoMove(g, now); return true; }
  return false;
}
function endRound(g, winnerSeat, now) {
  const rows = g.players.map((p) => {
    const tc = g.melds.flatMap((m) => m.cards).filter((x) => x.by === p.seat);
    const table = tc.reduce((a, x) => a + tableVal({ c: parse(x.c), as: x.as }), 0);
    const hand = p.hand.reduce((a, c) => a + val(parse(c)), 0);
    return { seat: p.seat, table, hand, sum: table - hand, tableCards: tc.map((x) => x.c), handCards: [...p.hand] };
  });
  rows.forEach((r) => { g.players[r.seat].score += r.sum; });
  g.rounds.push(rows.map((r) => r.sum));
  g.roundEnd = { round: g.round, winner: winnerSeat, rows, at: now };
  g.phase = 'roundEnd'; g.starter = winnerSeat; g.players.forEach((p) => (p.ready = false));
  g.log.push({ t: now, m: g.players[winnerSeat].name + ' je šel ven. Konec runde ' + g.round + '.' });
  const over = g.players.filter((p) => p.score >= g.goal);
  if (over.length) { const w = over.sort((a, b) => b.score - a.score)[0]; g.status = 'finished'; g.winner = w.seat; g.log.push({ t: now, m: w.name + ' je zmagal igro s ' + w.score + ' točkami!' }); }
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
    paused: g.paused, now, deckCount: g.deck.length, discard: g.discard.slice(-3), discardCount: g.discard.length, drawnTop: g.drawnTop,
    melds: g.melds, rounds: g.rounds, roundEnd: g.roundEnd, roundStartedAt: g.roundStartedAt, log: g.log.slice(-12),
    turnsInRound: g.turnsInRound, playersCount: g.players.length,
    players: g.players.map((p) => ({ seat: p.seat, id: p.id, name: p.name, handCount: p.hand.length, opened: p.opened, score: p.score, ready: p.ready })),
    me: me ? { seat: me.seat, hand: me.hand, opened: me.opened } : null,
  };
}
