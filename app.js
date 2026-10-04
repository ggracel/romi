// foqs.romi - klient. Vsa pravila preveri strežnik (edge funkcija "romi"); tukaj je samo prikaz, predogled in animacije.
import * as E from './engine.js?v=12';
const { validate, arrange, addOptions, isJ, parse, val, RANKS } = E;

const SB_URL = 'https://cgnihdlprjqpawvpznsw.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnbmloZGxwcmpxcGF3dnB6bnN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3ODAwODAsImV4cCI6MjEwMTM1NjA4MH0.HQgn-5op-0BYAMllyE3rbhwlLPILxvl1OVnqXau_33g';
const MOCK = new URLSearchParams(location.search).has('mock');
const COLORS = ['var(--teal)', 'var(--warn)', 'var(--pos)', 'var(--viol)'];
const $ = (s) => document.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const red = (s) => s === '♥' || s === '♦';

/* ================= stanje klienta ================= */
const S = { user: null, rooms: [], room: null, players: [], view: null, sel: new Set(), order: [], sort: 'rank', offset: 0, handOrder: [], busy: false, lastLogLen: 0, prevTurn: null, prevRound: 0 };

/* ================= transport ================= */
let sb = null, api, subscribeRooms, subscribeRoom, unsubscribeRoom, auth;
if (!MOCK) {
  if (!window.supabase) { document.body.dataset.screen = 'login'; document.querySelector('[data-view="login"]').hidden = false; document.getElementById('lgErr').textContent = 'Knjižnica za prijavo se ni naložila. Osveži stran.'; throw new Error('supabase-js manjka'); }
  // Brez navigator.locks: ko je hub odprt v drugem zavihku, zaklep lahko zadrži romi in getSession vrne prazno.
  sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, lock: async (_name, _timeout, fn) => fn() } });
  let memSession = null;
  sb.auth.onAuthStateChange((_e, s) => { if (s) memSession = s; });
  async function token(force) {
    let s = null;
    if (!force) { try { s = (await sb.auth.getSession()).data.session; } catch (_) { s = null; } }
    if (!s || force || (s.expires_at && s.expires_at * 1000 < Date.now() + 30000)) { try { const r = await sb.auth.refreshSession(); if (r.data.session) s = r.data.session; } catch (_) { /* naprej */ } }
    if (!s && memSession && memSession.expires_at * 1000 > Date.now()) s = memSession;
    if (s) memSession = s;
    return s ? s.access_token : null;
  }
  async function post(body, tok) { const r = await fetch(SB_URL + '/functions/v1/romi?forceFunctionRegion=eu-west-1', { method: 'POST', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({ error: 'Strežnik ni odgovoril.' })); return { r, j }; }
  api = async (body) => {
    let tok = await token(false);
    if (!tok) { needLogin(); throw new Error('Prijava je potekla. Prijavi se še enkrat.'); }
    let { r, j } = await post(body, tok);
    if (r.status === 401) { tok = await token(true); if (tok) ({ r, j } = await post(body, tok)); }
    if (r.status === 401) { needLogin(); throw new Error('Prijava je potekla. Prijavi se še enkrat.'); }
    if (!r.ok) throw new Error(j.error || 'Napaka.');
    return j;
  };
  auth = {
    async session() { let s = null; try { s = (await sb.auth.getSession()).data.session; } catch (_) {} if (!s) { try { s = (await sb.auth.refreshSession()).data.session; } catch (_) {} } if (s) memSession = s; return s?.user ?? null; },
    async login(email, password) { const { data, error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw new Error('Napačen e-naslov ali geslo.'); memSession = data.session; return data.user; },
    async logout() { await sb.auth.signOut({ scope: 'local' }); },
  };
  let roomsCh = null, roomCh = null;
  subscribeRooms = (cb) => { if (roomsCh) return; roomsCh = sb.channel('romi-lobby').on('postgres_changes', { event: '*', schema: 'public', table: 'romi_rooms' }, cb).on('postgres_changes', { event: '*', schema: 'public', table: 'romi_players' }, cb).subscribe(); };
  subscribeRoom = (id, cb) => { unsubscribeRoom(); roomCh = sb.channel('romi-room-' + id).on('postgres_changes', { event: '*', schema: 'public', table: 'romi_rooms', filter: 'id=eq.' + id }, cb).on('postgres_changes', { event: '*', schema: 'public', table: 'romi_players', filter: 'room_id=eq.' + id }, cb).subscribe(); };
  unsubscribeRoom = () => { if (roomCh) { sb.removeChannel(roomCh); roomCh = null; } };
} else {
  /* ---- lokalni testni način (?mock=1): igra teče v brskalniku, 3 soigralci igrajo sami ---- */
  const M = { rooms: [{ id: 'r1', name: 'Testna soba', admin: 'me', turn_time: 60, goal: 500, status: 'waiting' }], players: [{ room_id: 'r1', user_id: 'me', name: 'Gašper', seat: 0 }, { room_id: 'r1', user_id: 'b1', name: 'Jaka', seat: 1 }, { room_id: 'r1', user_id: 'b2', name: 'Nejc', seat: 2 }, { room_id: 'r1', user_id: 'b3', name: 'Maja', seat: 3 }], game: null, cbs: new Set() };
  const notify = () => M.cbs.forEach((cb) => setTimeout(cb, 30));
  const botPlay = () => { const g = M.game; if (!g || g.status !== 'playing' || g.phase === 'roundEnd' || g.paused) return; const p = g.players[g.turn]; if (p.id === 'me') return;
    setTimeout(() => { const g2 = M.game; if (!g2 || g2.paused || g2.players[g2.turn].id !== p.id || g2.phase === 'roundEnd') return; const now = Date.now();
      try { if (g2.phase === 'draw') E.act(g2, g2.turn, { type: 'draw', from: Math.random() < .3 && g2.discard.length ? 'top' : 'deck' }, now);
        const hand = p.hand.map(parse); let laid = false;
        for (let a = 0; a < hand.length && !laid; a++) for (let b = a + 1; b < hand.length && !laid; b++) for (let c = b + 1; c < hand.length && !laid; c++) { const cs = [hand[a], hand[b], hand[c]]; if (validate(cs) && p.hand.length > 3) { E.act(g2, g2.turn, { type: 'lay', ids: cs.map((x) => x.id) }, now); laid = true; } }
        const nonJ = p.hand.filter((c) => !isJ(c)); const pool = nonJ.length ? nonJ : p.hand; E.act(g2, g2.turn, { type: 'discard', id: pool[0] }, now);
      } catch (e) { console.warn('bot', e.message); E.checkTimeout(g2, now + 999999); }
      mockAward(g2); notify(); botPlay(); }, 1500 + Math.random() * 1500); };
  const botsReady = () => setTimeout(() => { const g = M.game; if (g && g.phase === 'roundEnd') { g.players.forEach((p) => { if (p.id !== 'me') p.ready = true; }); if (g.players.every((p) => p.ready)) { E.startRound(g, Date.now()); botPlay(); } notify(); } }, 2500);
  const mDay = () => new Date().toISOString().slice(0, 10);
  M.camp = { 1: 3, 2: 2, 3: 1 }; M.taskProg = { play1: 0, lay: 2, swap: 1 }; M.taskClaimed = [];
  M.wallet = { coins: 340, streak: 2, last_daily: '', owned: ['back_classic', 'face_classic'], back: 'classic', face: 'classic' }; M.dailyResult = null;
  const MSHOP = { back_gold: 400, back_night: 300, back_wine: 300, face_big: 500 };
  const mockTasks = (g) => { if (!g) return; const p = g.players[0]; const ev = p.ev || {}, sent = p.evSent || {}; for (const k of Object.keys(ev)) M.taskProg[k] = (M.taskProg[k] || 0) + (ev[k] - (sent[k] || 0)); p.evSent = { ...ev }; if (g.status === 'finished' && !g.tasksDone && !g.abandoned) { g.tasksDone = true; M.taskProg.play1 = (M.taskProg.play1 || 0) + 1; } };
  const mockCamp = (g) => { if (!g || !g.campaign || g.status !== 'finished' || g.coinsDone || g.abandoned) return; g.coinsDone = true; g.awards = {}; const res = E.campaignResult(g); if (!res) return; const lv = E.CAMPAIGN.levels.find((x) => x.n === g.campaign); const prev = M.camp[g.campaign] || 0; const parts = []; if (res.won && !prev) parts.push({ label: 'Prvič premagan nivo ' + lv.n, n: lv.coins }); if (res.stars > prev) parts.push({ label: 'Nove zvezdice ×' + (res.stars - prev), n: 10 * (res.stars - prev) }); if (res.won && prev) parts.push({ label: 'Ponovna zmaga', n: 5 }); const total = parts.reduce((a, x) => a + x.n, 0); if (res.stars > prev) M.camp[g.campaign] = res.stars; M.wallet.coins += total; let unlock = null; if (res.won && !prev && lv.unlock) { M.wallet.owned.push(lv.unlock); unlock = lv.unlock; } g.awards[res.seat] = { total, parts, credited: total, place: res.won ? 0 : 1, campaign: { ...res, prev, unlock } }; };
  const mockAward = (g) => { mockTasks(g); mockCamp(g); if (g && g.status === 'finished' && !g.coinsDone && !g.abandoned && (g.finishedNaturally || g.daily)) { g.coinsDone = true; g.awards = {}; const aw = E.computeAwards(g) || {}; for (const [st, a] of Object.entries(aw)) { g.awards[st] = { ...a, credited: a.total, limited: false }; if (g.players[+st].id === 'me') { M.wallet.coins += a.total; if (g.daily) M.dailyResult = { ...M.dailyResult, score: g.rounds[0][+st], won: a.place === 0 }; } } } };
  api = async (body) => { const now = Date.now(); await new Promise((r) => setTimeout(r, 80));
    if (body.action === 'wallet') { const w = M.wallet; const pr = M.taskProg; const tasks = [['play1', 'Odigraj eno igro do konca', 1, 'play1'], ['lay3', 'Položi 3 kombinacije', 3, 'lay'], ['swap', 'Zamenjaj jokerja na mizi', 1, 'swap']].map(([key, label, target, ek]) => ({ key, label, target, progress: Math.min(target, pr[ek] || 0), claimed: M.taskClaimed.includes(ek), reward: 15 }));
      return { wallet: { ...w }, today: mDay(), dailyAvail: w.last_daily !== mDay(), nextDaily: { streak: w.streak + 1, amount: [10, 15, 20, 25, 30, 40, 80][w.streak] }, dailyResult: M.dailyResult, tasks, tasksBonus: { amount: 20, claimed: M.taskClaimed.includes('all') } }; }
    if (body.action === 'claim_task') { const ek = { play1: 'play1', lay3: 'lay', swap: 'swap' }[body.key]; const tg = { play1: 1, lay3: 3, swap: 1 }[body.key]; if ((M.taskProg[ek] || 0) < tg) throw new Error('Naloga še ni opravljena.'); if (M.taskClaimed.includes(ek)) throw new Error('To si že pobral.'); M.taskClaimed.push(ek); M.wallet.coins += 15; let bonus = 0; if (['play1', 'lay', 'swap'].every((k) => M.taskClaimed.includes(k)) && !M.taskClaimed.includes('all')) { M.taskClaimed.push('all'); bonus = 20; M.wallet.coins += 20; } return { claim: { ok: true, amount: 15, bonus }, wallet: { ...M.wallet } }; }
    if (body.action === 'campaign_info') { const tot = Object.values(M.camp).reduce((a, b) => a + b, 0); return { stars: { ...M.camp }, total: tot, top: [{ name: 'Jaka', total: 11, user_id: 'b1' }, { name: 'Gašper', total: tot, user_id: 'me' }].sort((a, b) => b.total - a.total) }; }
    if (body.action === 'campaign_start') { const lv = E.CAMPAIGN.levels.find((x) => x.n === +body.level); if (lv.n > 1 && !M.camp[lv.n - 1]) throw new Error('Najprej premagaj prejšnji nivo.'); const ps = [{ user_id: 'me', name: 'Gašper', seat: 0 }, ...lv.bots.map(([nm, l], i) => ({ user_id: 'c' + i, name: nm, seat: i + 1, is_bot: true, lvl: l }))];
      M.game = E.newGame(ps, body.noTimer ? 3600 : 90, lv.goal); M.game.campaign = lv.n; M.game.noTimer = !!body.noTimer; M.game.starter = 0; E.startRound(M.game, now);
      M.dailyRoom = { id: 'k' + lv.n, name: 'Kampanja · ' + lv.n + '. ' + lv.title, admin: 'me', turn_time: 90, goal: lv.goal, status: 'playing', private: true }; botPlay(); return { room: M.dailyRoom, view: JSON.parse(JSON.stringify(E.view(M.game, 0, now))) }; }
    if (body.action === 'claim_daily') { const w = M.wallet; if (w.last_daily === mDay()) return { claim: { ok: false }, wallet: { ...w } }; w.streak++; const amt = [10, 15, 20, 25, 30, 40, 80][w.streak - 1]; w.coins += amt; w.last_daily = mDay(); return { claim: { ok: true, amount: amt, streak: w.streak }, wallet: { ...w } }; }
    if (body.action === 'buy') { const w = M.wallet; const pr = MSHOP[body.item]; if (!pr) throw new Error('Tega v trgovini ni.'); if (w.owned.includes(body.item)) throw new Error('To že imaš.'); if (w.coins < pr) throw new Error('Premalo cekinov.'); w.coins -= pr; w.owned.push(body.item); return { wallet: { ...w } }; }
    if (body.action === 'equip') { const w = M.wallet; if (!w.owned.includes(body.item)) throw new Error('Tega še nimaš.'); const [k, n] = body.item.split('_'); w[k] = n; return { wallet: { ...w } }; }
    if (body.action === 'daily_start') { if (M.dailyResult) throw new Error('Današnji izziv si že odigral. Nov bo jutri.'); const ps = [{ user_id: 'me', name: 'Gašper', seat: 0 }, { user_id: 'b1', name: 'Ana', seat: 1, is_bot: true }, { user_id: 'b2', name: 'Bor', seat: 2, is_bot: true }];
      M.game = E.newGame(ps, 120, 9999); M.game.seed = E.seedOf('romi-' + mDay()); M.game.maxRounds = 1; M.game.daily = mDay(); M.game.starter = 0; M.game.players.forEach((p, i) => (p.bot = i > 0)); E.startRound(M.game, now);
      M.dailyRoom = { id: 'd1', name: 'Dnevni izziv', admin: 'me', turn_time: 120, goal: 9999, status: 'playing', private: true }; M.dailyResult = { score: null }; botPlay(); return { room: M.dailyRoom, view: JSON.parse(JSON.stringify(E.view(M.game, 0, now))) }; }
    if (body.action === 'create') { M.rooms[0] = { ...M.rooms[0], name: body.name, turn_time: body.turn_time, status: 'waiting' }; M.game = null; notify(); return { room: M.rooms[0] }; }
    if (body.action === 'join') return { room: M.rooms[0] };
    if (body.action === 'leave') return {};
    if (body.action === 'kick') { M.players = M.players.filter((p) => p.user_id !== body.user_id); notify(); return {}; }
    if (body.action === 'start') { M.game = E.newGame(M.players, M.rooms[0].turn_time, 500); M.game.starter = 0; E.startRound(M.game, now); M.rooms[0].status = 'playing'; notify(); botPlay(); return { view: JSON.parse(JSON.stringify(E.view(M.game, 0, now))) }; }
    if (body.action === 'end') { M.game.status = 'finished'; M.rooms[0].status = 'finished'; notify(); return {}; }
    const g = M.game; if (!g) throw new Error('Igra še ni začeta.');
    if (body.action === 'quit') { E.quit(g, 0, now); M.players = M.players.filter((p) => p.user_id !== 'me'); notify(); return { quit: true }; }
    if (body.action === 'hint') { if (M.wallet.coins < 20) throw new Error('Za namig rabiš 20 cekinov.'); const h = E.findHint(g, 0); if (h) M.wallet.coins -= 20; return { hint: h, view: JSON.parse(JSON.stringify(E.view(g, 0, now))) }; }
    if (body.action === 'pause') { g.paused = true; g.pausedAt = now; } else if (body.action === 'resume') { g.turnStarted += now - g.pausedAt; g.paused = false; botPlay(); }
    else if (body.action === 'view' || body.action === 'tick') { if (E.checkTimeout(g, now)) { botPlay(); notify(); } mockAward(g); return { view: JSON.parse(JSON.stringify(E.view(g, 0, now))) }; }
    else { if (E.checkTimeout(g, now)) { botPlay(); throw new Error('Čas je potekel, poteza je bila odigrana samodejno.'); } E.act(g, 0, { type: body.action, ...body }, now); if (body.action === 'discard') botPlay(); if (g.phase === 'roundEnd') botsReady(); }
    mockAward(g); notify(); return { view: JSON.parse(JSON.stringify(E.view(g, 0, now))) }; };
  auth = { async session() { return { id: 'me', email: 'gasper@foqs.si', user_metadata: { name: 'Gašper' } }; }, async login() { return this.session(); }, async logout() {} };
  subscribeRooms = (cb) => M.cbs.add(cb); subscribeRoom = (id, cb) => M.cbs.add(cb); unsubscribeRoom = () => {};
  window.__mock = M;
  // sobe/igralci v mocku beremo iz M namesto iz baze
  window.__mockRooms = () => ({ rooms: M.rooms, players: M.players, dailyRoom: M.dailyRoom });
}

/* ================= pomožno ================= */
let tt; function toast(msg, kind = '') { const t = $('#toast'); t.textContent = msg; t.className = 'toast show ' + kind; clearTimeout(tt); tt = setTimeout(() => (t.className = 'toast'), 2400); }
function show(name) { document.body.dataset.screen = name; $$('.view').forEach((v) => (v.hidden = v.dataset.view !== name)); }
function ini(n) { return (n || '?').trim()[0].toUpperCase(); }
function myName() { const m = S.user?.user_metadata || {}; return m.name || m.full_name || (S.user?.email || '').split('@')[0]; }
async function call(body, { quiet } = {}) {
  if (S.busy && !quiet) return null; if (quiet && S.pending) return null; S.busy = !quiet; if (!quiet) document.body.classList.add('wait');
  const my = ++S.seq;
  try { const r = await api({ room_id: S.room?.id, ...body }); if (r.view && my > S.applied && !S.pending) { S.applied = my; applyView(r.view); } if (r.players && !r.view) { S.room = r.room || S.room; S.players = r.players; if (document.body.dataset.screen === 'create') renderRoom(); } return r; }
  catch (e) { if (!quiet) toast(e.message, 'bad'); else console.warn(e.message); return null; }
  finally { if (!quiet) S.busy = false; document.body.classList.remove('wait'); }
}
// poteze v igri: takoj lokalno, strežniku po vrsti (brez čakanja na odgovor prejšnje); pogled vzamemo samo iz zadnjega odgovora
S.q = Promise.resolve(); S.pending = 0; S.seq = 0; S.applied = 0;
function play(body) {
  S.pending++; const my = ++S.seq;
  const run = async () => { try { const r = await api({ room_id: S.room?.id, ...body }); if (r.view && S.pending === 1 && my > S.applied) { S.applied = my; applyView(r.view); } return r; }
    catch (e) { toast(e.message, 'bad'); S.needSync = true; return null; }
    finally { S.pending--; if (!S.pending && S.needSync) { S.needSync = false; call({ action: 'view' }, { quiet: true }); } } };
  const p = S.q.then(run); S.q = p; return p;
}

/* ================= karte ================= */
const PIPS = { 3: [[1, 0], [1, 3], [1, 6]], 4: [[0, 0], [2, 0], [0, 6], [2, 6]], 5: [[0, 0], [2, 0], [1, 3], [0, 6], [2, 6]], 6: [[0, 0], [2, 0], [0, 3], [2, 3], [0, 6], [2, 6]], 7: [[0, 0], [2, 0], [1, 1.5], [0, 3], [2, 3], [0, 6], [2, 6]], 8: [[0, 0], [2, 0], [1, 1.5], [0, 3], [2, 3], [1, 4.5], [0, 6], [2, 6]], 9: [[0, 0], [2, 0], [0, 2], [2, 2], [1, 3], [0, 4], [2, 4], [0, 6], [2, 6]], 10: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2], [0, 4], [2, 4], [1, 5], [0, 6], [2, 6]] };
function cardEl(c, cls = '', as = null) {
  if (typeof c === 'string') c = parse(c);
  const e = document.createElement('div');
  e.className = 'card ' + (red(c.s) ? 'red ' : '') + (isJ(c) ? 'joker ' : '') + cls; e.dataset.id = c.id;
  const ix = `<span class="ix">${c.r}<i>${c.s}</i></span><span class="ix b">${c.r}<i>${c.s}</i></span>`;
  if (isJ(c)) { e.innerHTML = ix + `<div class="jk"><b>2</b></div><b class="jl">${as && as.r !== '?' ? '= ' + as.r + (as.s !== '?' ? as.s : '') : 'JOKER'}</b>`; return e; }
  if (c.r === 'A') e.innerHTML = ix + `<div class="ace">${c.s}</div>`;
  else if (['J', 'Q', 'K'].includes(c.r)) e.innerHTML = ix + `<div class="face"><b data-s="${c.s}">${c.r}</b><small>${{ J: 'FANT', Q: 'DAMA', K: 'KRALJ' }[c.r]}</small></div>`;
  else { const n = +c.r; e.innerHTML = ix + `<div class="pips">${(PIPS[n] || []).map(([x, y]) => `<span class="${y > 3 ? 'f' : ''}" style="left:${x * 50}%;top:${y / 6 * 100}%">${c.s}</span>`).join('')}</div>`; }
  return e;
}
function backEl() { const e = document.createElement('div'); e.className = 'card back'; e.innerHTML = '<i class="q"></i>'; return e; }
const RVH = (c) => (E.RV(c) === 1 ? 14 : E.RV(c)); // As je najvišji
function sortHand(h, mode) { const key = mode === 'rank' ? (c) => RVH(c) * 10 + E.SUITS.indexOf(c.s) : (c) => E.SUITS.indexOf(c.s) * 20 + RVH(c); return [...h].sort((a, b) => key(a) - key(b)); }
/* vrstni red kart v roki: uporabnik ga lahko premika z miško; nove karte gredo na konec */
function handOrdered(hand) {
  const ids = hand.map((c) => c.id); S.handOrder = (S.handOrder || []).filter((id) => ids.includes(id));
  for (const id of ids) if (!S.handOrder.includes(id)) S.handOrder.push(id);
  return S.handOrder.map((id) => hand.find((c) => c.id === id));
}
function applySort(mode) { const v = S.view; if (!v) return; S.handOrder = sortHand(v.me.hand.map(parse), mode).map((c) => c.id); render(); }

/* ================= telefon / tablica ================= */
function layoutMode() {
  const w = innerWidth, h = innerHeight, b = document.body.classList; const mob = w < 1100 || h < 600;
  b.toggle('mob', mob); b.toggle('por', mob && h >= w); b.toggle('land', mob && w > h); b.toggle('tab', mob && Math.min(w, h) >= 700);
  if (!mob) b.remove('menu-open');
}
layoutMode();
let rsT; addEventListener('resize', () => { clearTimeout(rsT); rsT = setTimeout(() => { layoutMode(); if (S.view && document.body.dataset.screen === 'game') render(); }, 120); });
/* roka na malem zaslonu: karte se razporedijo po širini, pokončno po potrebi v 2 vrsti */
function fitHand() {
  const h = $('#hand'); const cards = $$('#hand .card');
  if (!document.body.classList.contains('mob')) { h.style.height = ''; cards.forEach((e) => { e.style.left = e.style.top = e.style.zIndex = ''; }); return; }
  const cs = getComputedStyle(h); const cw = parseFloat(cs.getPropertyValue('--cw')) || 60, ch = parseFloat(cs.getPropertyValue('--ch')) || 84; const W = h.clientWidth; const n = cards.length;
  const top = 14, gap = 8; const rows = document.body.classList.contains('por') && n * cw * 0.55 + cw * 0.45 > W ? 2 : 1; const per = Math.ceil(n / rows) || 1;
  cards.forEach((e, i) => { const r = Math.floor(i / per), k = i - r * per, inRow = r === rows - 1 ? n - r * per : per; const step = inRow > 1 ? Math.min(cw + 6, (W - cw) / (inRow - 1)) : 0; const x0 = (W - (step * (inRow - 1) + cw)) / 2;
    e.style.left = x0 + k * step + 'px'; e.style.top = top + r * (ch + gap) + 'px'; e.style.zIndex = i + 1; });
  h.style.height = top + rows * ch + (rows - 1) * gap + 4 + 'px';
}
$('#bMenu').onclick = () => document.body.classList.toggle('menu-open');
$('#menuShade').onclick = () => document.body.classList.remove('menu-open');
$('.scores').addEventListener('click', (e) => { if (e.target.closest('button')) document.body.classList.remove('menu-open'); });
/* zaslon ne ugasne med igro; ob vrnitvi v aplikacijo takoj osveži stanje */
let wakeL = null;
async function wake() { try { if ('wakeLock' in navigator && !wakeL && document.visibilityState === 'visible') { wakeL = await navigator.wakeLock.request('screen'); wakeL.addEventListener('release', () => (wakeL = null)); } } catch (_) { wakeL = null; } }
function unwake() { try { if (wakeL) wakeL.release(); } catch (_) {} wakeL = null; }
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !S.user) return; const sc = document.body.dataset.screen;
  if (sc === 'game' && S.room) { call({ action: 'view' }, { quiet: true }); wake(); } else if (sc === 'lobby') loadRooms(); else if (sc === 'create' && S.room) refreshRoom();
});

/* ================= prijava ================= */
let resumeAfterLogin = null;
function needLogin() { if (document.body.dataset.screen === 'login') return; resumeAfterLogin = { screen: document.body.dataset.screen, room: S.room }; $('#lgErr').textContent = 'Prijava je potekla. Prijavi se še enkrat, nato nadaljuješ, kjer si ostal.'; $('#lgErr').className = 'authmsg err'; show('login'); }
async function boot() {
  drawBg();
  const u = await auth.session();
  if (!u) { show('login'); return; }
  S.user = u; $('#meName').textContent = myName(); $('#meIni').textContent = ini(myName());
  await enterLobby();
}
$('#loginForm').addEventListener('submit', async (e) => { e.preventDefault(); const b = $('#lgBtn'); b.disabled = true; $('#lgErr').textContent = ''; $('#lgErr').className = 'authmsg';
  try { S.user = await auth.login($('#lgEmail').value.trim(), $('#lgPass').value); $('#meName').textContent = myName(); $('#meIni').textContent = ini(myName()); const rs = resumeAfterLogin; resumeAfterLogin = null; if (rs && rs.room) { S.room = rs.room; if (rs.screen === 'game') startGame(); else enterRoom(rs.room); } else if (rs && rs.screen === 'create') { show('create'); } else await enterLobby(); } catch (err) { $('#lgErr').textContent = err.message; $('#lgErr').className = 'authmsg err'; } finally { b.disabled = false; } });
$('#btnLogout').onclick = async () => { await auth.logout(); location.reload(); };

/* ================= sobe ================= */
async function loadRooms() {
  if (MOCK) { const m = window.__mockRooms(); S.rooms = m.rooms.filter((r) => r.status !== 'finished'); S.allPlayers = m.players; }
  else {
    const since = new Date(Date.now() - 24 * 3600e3).toISOString();
    const [{ data: rooms }, { data: players }] = await Promise.all([sb.from('romi_rooms').select('*').eq('private', false).neq('status', 'finished').gt('updated_at', since).order('created_at', { ascending: false }), sb.from('romi_players').select('*')]);
    S.rooms = rooms || []; S.allPlayers = players || [];
  }
  renderRooms();
}
async function enterLobby() {
  unwake(); document.body.classList.remove('menu-open'); show('lobby'); loadLeaderboard(); await loadRooms(); subscribeRooms(() => { if (document.body.dataset.screen === 'lobby') loadRooms(); });
  // če sem že v sobi (npr. osvežitev strani), me vrni vanjo
  loadCamp().then(() => renderToday()); loadWallet();
  const mine = S.allPlayers.find((p) => p.user_id === S.user.id); const r = mine && S.rooms.find((x) => x.id === mine.room_id);
  if (r) return enterRoom(r);
  // dnevni izziv (zasebna soba) po osvežitvi strani: vrni se v igro
  if (mine && !MOCK) { const { data: pr } = await sb.from('romi_rooms').select('*').eq('id', mine.room_id).maybeSingle(); if (pr && pr.private && pr.status === 'playing') { S.room = pr; subscribeRoom(pr.id, () => refreshRoom()); startGame(); } }
}
function renderRooms() {
  const el = $('#rooms'); const uid = S.user.id;
  const cards = S.rooms.map((r) => { const ps = S.allPlayers.filter((p) => p.room_id === r.id).sort((a, b) => a.seat - b.seat); const mine = ps.some((p) => p.user_id === uid); const adminName = ps.find((p) => p.user_id === r.admin)?.name || '?';
    const st = r.status === 'playing' ? '<i></i>V teku' : `<i class="w"></i>Čaka na igralce · ${ps.length}/4`;
    const btn = mine ? '<button class="btn pri join">Vrni se v sobo</button>' : r.status === 'playing' ? '<button class="btn join" disabled>Igra teče</button>' : ps.length >= 4 ? '<button class="btn join" disabled>Polna</button>' : '<button class="btn join">Pridruži se</button>';
    return `<div class="room ${mine ? 'mine' : ''}" data-id="${r.id}"><div class="st">${st}</div><h3>${esc(r.name)}</h3><div class="avs">${ps.map((p, i) => `<div class="av" style="background:${COLORS[i]};color:#0d2c2e" title="${esc(p.name)}">${ini(p.name)}</div>`).join('')}${Array.from({ length: 4 - ps.length }, () => '<div class="av empty">+</div>').join('')}</div><div class="mono">Admin: ${esc(adminName)} · ${r.turn_time} s na potezo</div>${btn}</div>`; });
  el.innerHTML = cards.join('') + '<div class="room new" id="roomNew"><div><div class="plus">+</div><b>Nova soba</b><span style="font-size:13px">Ti si admin, ti začneš igro.</span></div></div>';
  $$('#rooms .room[data-id]').forEach((c) => (c.onclick = async () => { const r = S.rooms.find((x) => x.id === c.dataset.id); if (!r) return; const mine = S.allPlayers.some((p) => p.room_id === r.id && p.user_id === uid); if (!mine && r.status !== 'waiting') return toast('Igra v tej sobi že teče'); if (!mine) { const res = await call({ action: 'join', room_id: r.id }); if (!res) return; } enterRoom(r); }));
  $('#roomNew').onclick = () => { S.room = null; $('#crForm').hidden = false; $('#crInfo').hidden = true; $('#crName').value = ''; $('#rp').innerHTML = ''; $('#rpN').textContent = '0/4'; $('#bStart').disabled = true; $('#crSub').textContent = ''; show('create'); };
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
$('#crTime').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; $$('#crTime button').forEach((x) => x.setAttribute('aria-pressed', x === b)); };
$('#btnCreate').onclick = async () => { const name = $('#crName').value.trim() || 'Nova soba'; const t = +$('#crTime [aria-pressed="true"]').dataset.t; const r = await call({ action: 'create', name, turn_time: t }); if (r?.room) { S.room = r.room; S.players = r.players || []; $('#crForm').hidden = true; $('#crInfo').hidden = false; renderRoom(); subscribeRoom(r.room.id, () => refreshRoom()); } };
$('#btnBack').onclick = () => { unsubscribeRoom(); S.room = null; enterLobby(); };
$('#btnLeave').onclick = async () => { await call({ action: 'leave' }); unsubscribeRoom(); S.room = null; enterLobby(); };
$('#bStart').onclick = async () => { const r = await call({ action: 'start' }); if (r?.view) startGame(); };

/* ================= čakalnica ================= */
async function enterRoom(r) {
  S.room = r; show('create');
  $('#crForm').hidden = true; $('#crInfo').hidden = false;
  subscribeRoom(r.id, () => refreshRoom());
  await refreshRoom();
}
async function refreshRoom() {
  if (!S.room) return;
  if (MOCK) { const m = window.__mockRooms(); if (S.room.private) return; S.room = m.rooms[0]; S.players = m.players; }
  else {
    const [{ data: r }, { data: ps }] = await Promise.all([sb.from('romi_rooms').select('*').eq('id', S.room.id).maybeSingle(), sb.from('romi_players').select('*').eq('room_id', S.room.id).order('seat')]);
    if (!r) { toast('Soba je bila zaprta'); unsubscribeRoom(); S.room = null; return enterLobby(); }
    S.room = r; S.players = ps || [];
    if (!S.players.some((p) => p.user_id === S.user.id)) { toast('Admin te je odstranil iz sobe'); unsubscribeRoom(); S.room = null; return enterLobby(); }
  }
  renderRoom();
}
function renderRoom() {
  if (!S.room) return;
  if (S.room.status === 'playing') { if (document.body.dataset.screen !== 'game') startGame(); else call({ action: 'view' }, { quiet: true }); return; }
  if (S.room.status === 'finished') { return; }
  const isAdmin = S.room.admin === S.user.id;
  $('#wiName').textContent = S.room.name; $('#wiSet').textContent = S.room.turn_time + ' s na potezo · do 500 točk';
  $('#crSub').textContent = isAdmin ? '' : 'Čakalnica · igro zažene admin.';
  $('#wiNote').textContent = isAdmin ? 'Prijatelji te sobo vidijo v seznamu in se pridružijo sami. Ko so vsi notri, klikni Začni igro.' : 'Počakaj, da admin zažene igro. Stran se posodobi sama.';
  $('#rp').innerHTML = S.players.map((p, i) => `<div class="rpl"><div class="av" style="background:${COLORS[i]};color:#0d2c2e">${ini(p.name)}</div><div class="nm">${esc(p.name)}${p.user_id === S.room.admin ? ' <small>admin</small>' : ''}${p.is_bot ? ' <span class="small-note">bot</span>' : ''}${p.user_id === S.user.id ? ' <span class="small-note">(ti)</span>' : ''}</div>${isAdmin && p.user_id !== S.user.id ? `<button class="x" data-k="${p.user_id}" title="Odstrani">×</button>` : ''}</div>`).join('') + Array.from({ length: 4 - S.players.length }, () => '<div class="rpl empty"><div class="av empty">+</div><div class="nm">Čaka na igralca …</div></div>').join('');
  $$('#rp .x').forEach((b) => (b.onclick = () => call({ action: 'kick', user_id: b.dataset.k })));
  if (isAdmin && S.players.length < 4) { const bb = document.createElement('button'); bb.className = 'btn'; bb.style.cssText = 'width:100%;justify-content:center;margin-top:4px;font-size:12.5px'; bb.textContent = '+ Dodaj testnega bota'; bb.onclick = () => call({ action: 'add_bot' }); $('#rp').appendChild(bb); }
  $('#rpN').textContent = S.players.length + '/4'; $('#rpLive').innerHTML = '<span class="spin"></span> v živo';
  const b = $('#bStart'); b.hidden = !isAdmin; b.disabled = S.players.length < 2; b.textContent = S.players.length < 2 ? 'Začni igro (vsaj 2 igralca)' : 'Začni igro (' + S.players.length + ' igralci)';
  $('#btnLeave').textContent = isAdmin ? 'Zapri sobo' : 'Zapusti sobo';
}

/* ================= igra ================= */
let timerIv = null, pollIv = null;
async function startGame() {
  show('game'); S.sel.clear(); S.order = []; S.prevTurn = null; S.prevRound = 0;
  $('#gRoom').textContent = S.room.name;
  const isAdmin = S.room.admin === S.user.id && !S.room.private; $('#bPause').hidden = !isAdmin; $('#bEnd').hidden = !isAdmin; $('#bResume').hidden = !isAdmin;
  await call({ action: 'view' }, { quiet: true });
  clearInterval(timerIv); timerIv = setInterval(tickTimer, 500); wake();
  clearInterval(pollIv); pollIv = setInterval(() => { if (document.body.dataset.screen === 'game' && !S.busy) call({ action: 'view' }, { quiet: true }); }, 8000);
}
function applyView(v) {
  const prev = S.view; S.view = v; S.offset = Date.now() - v.now;
  // izbor očisti, če kart ni več v roki
  S.order = S.order.filter((id) => v.me.hand.includes(id)); S.sel = new Set(S.order);
  render(prev);
}
function seatMap() { // moj sedež spodaj, ostali v smeri urinega kazalca: levo, zgoraj, desno
  const v = S.view; const n = v.players.length; const me = v.me.seat; const order = []; for (let i = 1; i < n; i++) order.push((me + i) % n);
  const zones = n === 2 ? ['top'] : n === 3 ? ['left', 'right'] : ['left', 'top', 'right'];
  const map = { me }; zones.forEach((z, i) => (map[z] = order[i])); return map;
}
function turnLeft() { const v = S.view; if (!v) return 0; if (v.paused) return Math.max(0, Math.ceil((v.turnTime * 1000 - (v.pausedAt || 0)) / 1000)); return Math.max(0, Math.ceil((v.turnTime * 1000 - (Date.now() - S.offset - v.turnStarted)) / 1000)); }
function tickTimer() {
  const v = S.view; if (!v || v.phase === 'roundEnd' || v.status !== 'playing') return;
  const left = v.paused ? Math.ceil((v.turnTime * 1000 - (v.pausedAtLeft || 0)) / 1000) : turnLeft();
  $$('[data-timer]').forEach((e) => { e.textContent = left; e.style.setProperty('--p', left / v.turnTime); });
  $$('.ring').forEach((r) => r.classList.toggle('urgent', left <= 10 && left > 0 && !v.paused));
  const curP = v.players[v.turn]; if (curP && curP.bot && !v.paused && !S.busy && !S.ticked && Date.now() - S.offset - v.turnStarted > 1250) { S.ticked = true; call({ action: 'tick' }, { quiet: true }).finally(() => setTimeout(() => (S.ticked = false), 350)); return; }
  if (left <= 0 && !v.paused && !S.busy && !S.ticked) { S.ticked = true; call({ action: 'tick' }, { quiet: true }).finally(() => setTimeout(() => (S.ticked = false), 2000)); }
}
function selCards() { return S.order.map((id) => parse(id)); }
function needDraw() { const v = S.view; return !!v && v.status === 'playing' && v.phase === 'draw' && v.turn === v.me.seat && !v.paused; }
function nudgeDraw() { toast('Najprej povleci karto: s kupa ali z odloženih', 'bad'); $$('#pDeck, #pDis').forEach((e) => { e.classList.remove('nudge'); void e.offsetWidth; e.classList.add('nudge'); }); }
function toggleSel(id) { if (needDraw()) return nudgeDraw(); if (S.sel.has(id)) { S.sel.delete(id); S.order = S.order.filter((x) => x !== id); } else { S.sel.add(id); S.order.push(id); } render(); }
function meldObj(m) { return { cards: m.cards.map((x) => ({ c: parse(x.c), by: x.by, as: x.as })) }; }

function render(prev) {
  const v = S.view; if (!v) return;
  const myTurn = v.turn === v.me.seat && v.phase !== 'roundEnd' && v.status === 'playing';
  const cs = selCards(); const val3 = validate(cs);
  $('#gRound').textContent = v.round; $('#gGoal').textContent = v.daily ? '1 runda' : v.goal;
  $('#gCoin').textContent = v.me.coins || 0; $('#bHint').hidden = !(v.campaign || v.daily) || !(v.turn === v.me.seat && v.phase === 'play');
  if (prev && prev.me && (v.me.coins || 0) > (prev.me.coins || 0)) { const k = Object.keys(v.me.ev || {}).find((x) => (v.me.ev[x] || 0) > ((prev.me.ev || {})[x] || 0)); coinPop(v.me.coins - (prev.me.coins || 0), k && E.COIN_EV[k] ? E.COIN_EV[k].label : 'Dobra poteza'); }
  $('#scores').innerHTML = v.players.map((p) => `<span class="chip"><i style="background:${COLORS[p.seat]}">${ini(p.name)}</i>${esc(p.name)} <em>${p.score}</em></span>`).join('');
  $('#deckN').textContent = v.deckCount + ' kart'; $('#disN').textContent = v.discardCount + ' kart';
  const ds = $('#disStack'); ds.innerHTML = ''; for (let k = 0; k < Math.min(2, v.discardCount - 1); k++) { const b = document.createElement('div'); b.className = 'card blank'; ds.appendChild(b); } v.discard.forEach((c) => ds.appendChild(cardEl(c)));
  $('#bAll').hidden = !(myTurn && v.phase === 'draw' && v.discardCount > 1); $('#bAllN').textContent = v.discardCount;
  const hot = myTurn && v.phase === 'draw'; $('#pDeck').classList.toggle('hot', hot); $('#pDis').classList.toggle('hot', hot); document.body.classList.toggle('need-draw', hot && !v.paused);
  const map = seatMap();
  $$('.zone').forEach((z) => { const seat = map[z.dataset.z]; if (seat === undefined) { z.hidden = true; return; } z.hidden = false; const p = v.players[seat];
    z.classList.toggle('turn', v.turn === seat && v.phase !== 'roundEnd');
    z.innerHTML = `<span class="tag">na potezi</span><div class="zh"><div class="av" style="background:${COLORS[seat]};color:#0d2c2e">${ini(p.name)}</div><div class="nm">${esc(p.name)}${seat === v.me.seat ? ' <span class="small-note">(ti)</span>' : ''}<small>${p.handCount} kart · ${p.score} točk${p.opened ? '' : ' · ni odprt'}${!p.bot && p.idle >= 2 ? ' · odsoten?' : ''}</small></div>${seat !== v.me.seat ? '<div class="fan">' + Array.from({ length: Math.min(p.handCount, 14) }, () => '<div class="card back"></div>').join('') + '<b class="fan-n">' + p.handCount + '</b>' + '</div>' : ''}<div class="ring"><span data-timer>${turnLeft()}</span></div></div><div class="zm"></div>`;
    const zm = z.querySelector('.zm'); const mine = v.melds.map((m, i) => [m, i]).filter(([m]) => m.owner === seat);
    if (!mine.length) zm.innerHTML = '<div class="none">' + (seat === v.me.seat ? 'Še nisi odprt. Izberi 3+ kart in klikni Položi.' : 'Še ni odprt') + '</div>';
    mine.forEach(([m, i]) => { const e = document.createElement('div'); e.className = 'meld'; e.dataset.mi = i; e.dataset.n = m.cards.length; const cs4 = m.cards.map((x) => parse(x.c)); const vv = validate(cs4); if (vv && vv.type === 'set' && m.cards.length === 4) e.classList.add('complete'); if (vv && vv.type === 'run' && m.cards.length >= 10) e.classList.add('complete');
      const opt = myTurn && v.phase === 'play' && cs.length === 1 && (v.me.opened || true) ? addOptions(meldObj(m), cs[0]) : null; if (opt) e.classList.add('can');
      m.cards.forEach((x, k) => { const ce = cardEl(x.c, x.by !== m.owner ? 'added' : '', x.as); if (S.flying && S.flying.has(x.c)) ce.style.visibility = 'hidden'; if (x.by !== m.owner) ce.style.setProperty('--who', COLORS[x.by]);
        if (opt && opt.swap === k) { ce.classList.add('swap'); const sp = document.createElement('button'); sp.className = 'pad sw'; sp.dataset.side = 'swap'; sp.innerHTML = '⇄<small>zamenjaj</small>'; sp.onclick = (ev) => { ev.stopPropagation(); doAdd(i, 'swap'); }; ce.appendChild(sp); }
        e.appendChild(ce); });
      if (opt && opt.swap !== undefined) { e.classList.add('swapable'); e.onclick = () => doAdd(i, 'swap'); }
      else if (opt && opt.lo && opt.hi) { e.classList.add('two'); const L = document.createElement('button'); L.className = 'pad lo'; L.dataset.side = 'lo'; L.innerHTML = `<i>◀ 2 =</i>${opt.lo.as.r}${opt.lo.as.s}`; L.onclick = (ev) => { ev.stopPropagation(); doAdd(i, 'lo'); }; const R = document.createElement('button'); R.className = 'pad hi'; R.dataset.side = 'hi'; R.innerHTML = `<i>2 = ▶</i>${opt.hi.as.r}${opt.hi.as.s}`; R.onclick = (ev) => { ev.stopPropagation(); doAdd(i, 'hi'); }; e.prepend(L); e.appendChild(R); }
      else e.onclick = () => doAdd(i);
      zm.appendChild(e); });
    if (seat === v.me.seat) { const away = v.melds.flatMap((m, i) => m.cards.filter((x) => x.by === seat && m.owner !== seat).map((x) => ({ x, m, i })));
      if (away.length) { const side = document.createElement('div'); side.className = 'away'; side.innerHTML = '<span class="mono">Dodal drugim</span>';
        away.forEach(({ x, m, i }) => { const w = document.createElement('div'); w.className = 'aw'; w.innerHTML = `<span class="aw-who" style="color:${COLORS[m.owner]}">${esc(v.players[m.owner].name)}</span>`; w.prepend(cardEl(x.c, 'xs', x.as)); w.onclick = () => { const t = $(`.meld[data-mi="${i}"]`); if (t) t.animate([{ boxShadow: '0 0 0 0 rgba(70,190,197,.7)' }, { boxShadow: '0 0 0 14px rgba(70,190,197,0)' }], { duration: 700 }); }; side.appendChild(w); });
        z.appendChild(side); } }
  });
  // roka
  const h = $('#hand'); const before = new Map(); $$('#hand .card').forEach((e) => before.set(e.dataset.id, e.getBoundingClientRect()));
  h.innerHTML = ''; handOrdered(v.me.hand.map(parse)).forEach((c) => { const e = cardEl(c, S.sel.has(c.id) ? 'sel' : ''); const o = document.createElement('span'); o.className = 'ord'; o.textContent = S.order.indexOf(c.id) + 1; e.appendChild(o); e.onclick = () => toggleSel(c.id); h.appendChild(e); });
  fitHand();
  flipHand(before, prev);
  // predogled
  const pv = $('#prev');
  if (cs.length >= 2) { const arr = arrange(cs, val3); pv.className = 'prev on ' + (val3 ? '' : 'bad');
    pv.innerHTML = val3 ? `<span class="lab">${val3.label}</span>` + arr.map((x) => x.as ? `<span class="pc j">2 = ${x.as.r}${x.as.s !== '?' ? x.as.s : ''}</span>` : `<span class="pc ${red(x.c.s) ? 'red' : ''}">${x.c.r}${x.c.s}</span>`).join('') : `<span class="lab">Ni veljavno</span>` + cs.map((c) => `<span class="pc ${red(c.s) ? 'red' : ''}">${c.r}${c.s}</span>`).join(''); }
  else if (myTurn && v.phase === 'draw') { pv.className = 'prev on draw'; pv.innerHTML = '<span class="lab">Najprej povleci</span><span class="dh">Tapni kup ali odložene ↑</span>'; }
  else pv.className = 'prev';
  const keep = v.turnsInRound < v.playersCount ? 2 : 1;
  const canLay = myTurn && v.phase === 'play' && val3 && v.me.hand.length - cs.length >= keep;
  $('#bLay').disabled = !canLay; $('#bLay').title = myTurn && v.phase === 'play' && val3 && !canLay ? (keep === 2 ? 'V prvem krogu ne moreš iti ven: obdrži vsaj 2 karti' : 'Eno karto moraš obdržati za zavreči') : '';
  const onlyJ = v.me.hand.every((c) => isJ(c)); const lastCardBlocked = v.me.hand.length === 1 && v.turnsInRound < v.playersCount;
  const canDis = myTurn && v.phase === 'play' && cs.length === 1 && (!isJ(cs[0]) || onlyJ) && !lastCardBlocked;
  $('#bDis').disabled = !canDis; $('#bDis').title = cs.length === 1 && isJ(cs[0]) && !onlyJ ? 'Jokerja ne moreš zavreči' : lastCardBlocked && cs.length === 1 ? 'V prvem krogu ne moreš zaključiti runde' : '';
  [['s1', myTurn && v.phase === 'draw' ? 'on' : myTurn ? 'done' : ''], ['s2', myTurn && v.phase === 'play' ? 'on' : ''], ['s3', myTurn && v.phase === 'play' && cs.length === 1 ? 'on' : '']].forEach(([id, c]) => ($('#' + id).className = 'step ' + c));
  // pavza, konec, dnevnik
  $('#pause').hidden = !v.paused; $('#bPause').textContent = v.paused ? 'Nadaljuj' : 'Pavza';
  if (v.status === 'finished') { renderAward(v); }
  $('#finNext').hidden = true; $('#finStars').innerHTML = ''; $('#finBack').textContent = v.campaign ? 'Na zemljevid' : 'Nazaj na sobe';
  if (v.status === 'finished' && v.campaign) { const a = v.me.award; const c = a && a.campaign; const lv = E.CAMPAIGN.levels[v.campaign - 1]; const w = v.players[v.winner];
    $('#finT').textContent = v.abandoned ? 'Igra se je zaprla' : c && c.won ? 'Nivo ' + v.campaign + ' premagan!' : 'Tokrat ni šlo';
    $('#finP').textContent = v.abandoned ? 'Nisi igral, zato se je igra zaprla. Poskusi znova.' : c && c.won ? (lv.boss && c.stars ? 'Premagal si ' + (lv.boss === 'šefica' ? 'šefico' : 'šefa') + ' ' + esc(acc(lv.bots[0][0])) + '! Celo poglavje ' + chOf(lv.n).place + ' je tvoje.' : c.stars === 3 ? 'Popolno, vse tri zvezdice. Pravi gostilniški mojster!' : 'Bravo! Za več zvezdic zmagaj z večjo razliko.') : (w ? esc(w.name) : 'Nasprotnik') + ' je bil tokrat boljši. Nič hudega, vsaka igra te nauči nekaj novega.';
    if (c) $('#finStars').innerHTML = '<span>' + [1, 2, 3].map((i) => `<i class="${i <= c.stars ? 'on' : ''}">★</i>`).join('') + '</span>' + (c.unlock ? '<p class="nt">Odklenil si ' + (BOSS_BACK[c.unlock] || 'nov hrbet kart') + '! Izbereš ga v trgovini.</p>' : '');
    const nx = c && c.won && v.campaign < E.CAMPAIGN.levels.length ? v.campaign + 1 : null; $('#finNext').hidden = v.abandoned; $('#finNext').textContent = nx ? 'Naslednji nivo: ' + E.CAMPAIGN.levels[nx - 1].title : 'Poskusi znova'; $('#finNext').dataset.lv = nx || v.campaign; $('#fin').hidden = false; }
  else if (v.status === 'finished' && v.daily) { const mine = v.players[v.me.seat]; const order = [...v.players].sort((a, b) => b.score - a.score); const pl = order.findIndex((p) => p.seat === v.me.seat) + 1; $('#finT').textContent = v.abandoned ? 'Izziv ni dokončan' : pl === 1 ? 'Zmagal si izziv!' : 'Izziv končan'; $('#finP').textContent = v.abandoned ? 'Igra se je zaprla, ker nisi igral. Nov izziv bo jutri.' : 'Tvoj rezultat: ' + mine.score + ' točk · ' + pl + '. mesto od ' + v.players.length + '. Lestvico dneva vidiš v sobah.'; $('#fin').hidden = false; }
  else if (v.status === 'finished') { const w = v.abandoned ? null : v.players[v.winner]; $('#finT').textContent = w ? (w.seat === v.me.seat ? 'Zmagal si!' : w.name + ' je zmagal') : 'Igra je končana'; $('#finP').textContent = w ? w.score + ' točk · ' + v.round + ' rund' : v.abandoned ? 'Soba se je zaprla, ker ni bilo več aktivnih igralcev.' : 'Admin je končal igro.'; $('#fin').hidden = false; }
  else $('#fin').hidden = true;
  if (v.phase === 'roundEnd' && v.status === 'playing') showLog(true); else if (S.logAuto) { $('#log').hidden = true; S.logAuto = false; }
  // mini dnevnik
  $('#miniLog').innerHTML = v.log.slice(-4).map((l) => `<div>${esc(l.m)}</div>`).join('');
  // obvestila ob spremembi poteze / runde
  if (prev && prev.turn !== v.turn && myTurn) banner(v.phase === 'draw' ? 'Na potezi si · najprej povleci' : 'Ti si na potezi');
  if (v.round >= 1 && v.phase !== 'roundEnd' && S.dealtRound !== v.round) { S.dealtRound = v.round; if (myTurn && v.phase === 'draw') setTimeout(() => banner('Ti začneš · najprej povleci'), 1400); S.handOrder = sortHand(v.me.hand.map(parse), S.sort).map((c) => c.id); render(); setTimeout(() => dealAnim(), 250); return; }
  if (prev && prev.log.length && v.log.length && v.log[v.log.length - 1].m !== prev.log[prev.log.length - 1].m) { const last = v.log[v.log.length - 1].m; if (!last.startsWith(myName())) toast(last); }
}
function banner(t) { const b = document.createElement('div'); b.className = 'turn-banner'; b.textContent = t; document.body.appendChild(b); setTimeout(() => b.remove(), 1700); }

/* ================= akcije ================= */
async function doDraw(from) { const v = S.view; if (!v || v.turn !== v.me.seat) return toast('Nisi na potezi'); if (v.phase !== 'draw') return toast('Karto si že potegnil'); if (S.busy) return;
  const src = from === 'deck' ? $('#pDeck .stack') : $('#disStack'); const srcR = rectOf(src); const before = new Set(v.me.hand);
  const hs = $$('#hand .card'); const last = hs[hs.length - 1]; const lr = last ? rectOf(last) : rectOf($('#hand')); const dest = { x: lr.x + (last ? lr.w - 18 : 0), y: lr.y, w: srcR.w, h: srcR.h };
  const ghost = from === 'deck' ? backEl() : (v.discard[0] ? cardEl(v.discard[0]) : backEl());
  const anim = from === 'all' ? Promise.resolve() : fly(ghost, srcR, dest, { dur: 380, rot: -10 });
  const r = await call({ action: 'draw', from }); if (!r) return;
  await anim;
  $$('#hand .card').forEach((e) => { if (!before.has(e.dataset.id)) e.animate([{ transform: 'translateY(-10px)', opacity: .6 }, { transform: 'none', opacity: 1 }], { duration: 220 }); }); }
async function doLay() { const cs = selCards(); const vl = validate(cs); if (!vl) return toast('Izbor ni veljavna kombinacija', 'bad');
  const v = S.view; const ids = cs.map((c) => c.id);
  const froms = {}; cs.forEach((c) => { const el = $(`#hand .card[data-id="${CSS.escape(c.id)}"]`); if (el) froms[c.id] = rectOf(el); });
  // lokalno takoj (enako kot strežnik), animacija steče brez čakanja
  v.melds.push({ owner: v.me.seat, cards: arrange(cs, vl).map((x) => ({ c: x.c.id, by: v.me.seat, as: x.as })) }); v.me.hand = v.me.hand.filter((id) => !ids.includes(id)); v.me.opened = true; S.sel.clear(); S.order = []; render();
  const meld = $(`.meld[data-mi="${v.melds.length - 1}"]`);
  if (meld) $$('.card', meld).forEach((e, i) => { const f = froms[e.dataset.id]; if (!f) return; e.style.visibility = 'hidden'; fly(e, f, rectOf(e), { delay: i * 50, dur: 380, rot: -6 }).then(() => { e.style.visibility = ''; e.animate([{ transform: 'scale(1.1)' }, { transform: 'none' }], { duration: 200 }); }); });
  play({ action: 'lay', ids }); }
async function doAdd(mi, side) { const cs = selCards(); if (cs.length !== 1) return toast('Izberi eno karto za dodajanje'); if (!S.view.me.opened) return toast('Najprej moraš odpreti (položiti svojo kombinacijo)', 'bad');
  const v = S.view; const card = cs[0]; const m = v.melds[mi]; if (!m) return;
  const el = $(`#hand .card[data-id="${CSS.escape(card.id)}"]`); const f = el ? rectOf(el) : null;
  const opt = addOptions(meldObj(m), card); if (!opt) return toast('Ta karta ne paše v to kombinacijo', 'bad');
  let joker = null;
  if (opt.swap !== undefined) { const old = m.cards[opt.swap]; joker = old.c; m.cards[opt.swap] = { c: card.id, by: old.by, as: null }; v.me.hand = v.me.hand.filter((x) => x !== card.id); v.me.hand.push(joker); }
  else { const arr = side === 'lo' && opt.lo ? opt.lo.arr : side === 'hi' && opt.hi ? opt.hi.arr : opt.auto; m.cards = arr.map((x) => { const o = m.cards.find((y) => y.c === x.c.id); return { c: x.c.id, by: o ? o.by : v.me.seat, as: x.as }; }); v.me.hand = v.me.hand.filter((x) => x !== card.id); }
  S.sel.clear(); S.order = []; render();
  const t = $(`.meld[data-mi="${mi}"] .card[data-id="${CSS.escape(card.id)}"]`);
  if (t && f) { t.style.visibility = 'hidden'; fly(t, f, rectOf(t), { dur: 380, rot: -6 }).then(() => { t.style.visibility = ''; t.closest('.meld').animate([{ boxShadow: '0 0 0 0 rgba(70,190,197,.6)' }, { boxShadow: '0 0 0 14px rgba(70,190,197,0)' }], { duration: 500 }); }); }
  if (joker && t) { const jn = $(`#hand .card[data-id="${CSS.escape(joker)}"]`); if (jn) { jn.style.visibility = 'hidden'; fly(jn, rectOf(t), rectOf(jn), { dur: 420, delay: 150, rot: 8 }).then(() => (jn.style.visibility = '')); toast('Zamenjal si jokerja, dvojka je v tvoji roki', 'ok'); } }
  play({ action: 'add', meld: mi, id: card.id, side }); }
async function doDiscard() { const cs = selCards(); if (cs.length !== 1) return toast('Izberi točno eno karto za zavreči');
  const v = S.view; const card = cs[0];
  const el = $(`#hand .card[data-id="${CSS.escape(card.id)}"]`); const from = el ? rectOf(el) : null; const to = rectOf($('#disStack'));
  v.me.hand = v.me.hand.filter((x) => x !== card.id); v.discard = [card.id]; v.discardCount++; v.phase = 'done'; S.sel.clear(); S.order = []; render();
  if (from) fly(cardEl(card), from, { x: to.x + 6, y: to.y - 6, w: from.w, h: from.h }, { rot: 12, dur: 360 });
  play({ action: 'discard', id: card.id }); }
$('#pDeck').onclick = () => doDraw('deck'); $('#disStack').onclick = () => doDraw('top'); $('#bAll').onclick = () => doDraw('all');
$$('#pDis .split button').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); doDraw(b.dataset.from); }));
$('#bLay').onclick = doLay; $('#bDis').onclick = doDiscard;
$('#bSort').onclick = () => { S.sort = S.sort === 'rank' ? 'suit' : 'rank'; applySort(S.sort); toast(S.sort === 'rank' ? 'Razvrščeno po vrednosti' : 'Razvrščeno po barvi'); };
$('#bPause').onclick = () => call({ action: S.view?.paused ? 'resume' : 'pause' }); $('#bResume').onclick = () => call({ action: 'resume' });
$('#bEnd').onclick = () => { if (confirm('Res končaš igro za vse?')) call({ action: 'end' }); };
$('#bLog').onclick = () => showLog(false);
$('#bQuit').onclick = async () => { if (!confirm('Res zapustiš igro? Tvoje karte bo do konca odigral računalnik, točke ne štejejo v lestvico.')) return; const r = await call({ action: 'quit' }); if (!r) return; clearInterval(timerIv); clearInterval(pollIv); unsubscribeRoom(); S.room = null; S.view = null; $('#fin').hidden = true; $('#log').hidden = true; toast('Zapustil si igro'); enterLobby(); };
$('#logClose').onclick = () => { $('#log').hidden = true; };
$('#finBack').onclick = () => { const camp = S.view && S.view.campaign; $('#fin').hidden = true; clearInterval(timerIv); clearInterval(pollIv); unsubscribeRoom(); S.room = null; S.view = null; if (camp) { loadWallet(); openCampaign(); } else enterLobby(); };
$('#finNext').onclick = () => { const n = +$('#finNext').dataset.lv; $('#fin').hidden = true; clearInterval(timerIv); clearInterval(pollIv); unsubscribeRoom(); S.room = null; S.view = null; S.campSel = n; loadWallet(); startCampaign(n); };
document.addEventListener('keydown', (e) => { if (document.body.dataset.screen !== 'game' || e.target.tagName === 'INPUT') return; if (e.key === 'r' || e.key === 'R') $('#bSort').click(); if (e.key === 'Enter' && !$('#bLay').disabled) doLay(); if ((e.key === 'd' || e.key === 'D') && !$('#bDis').disabled) doDiscard(); if (e.key === 'Escape') { S.sel.clear(); S.order = []; render(); } });

/* ================= dnevnik ================= */
function showLog(auto) {
  const v = S.view; if (!v) return; const o = $('#log'); S.logAuto = auto;
  const sig = [v.phase, v.round, v.rounds.length, v.players.map((p) => p.ready ? 1 : 0).join(''), v.status].join('|');
  if (!o.hidden && S.logSig === sig) return; S.logSig = sig; o.hidden = false;
  const re = v.roundEnd; const f = (n) => `<span class="${n > 0 ? 'pos' : n < 0 ? 'neg' : ''}">${n > 0 ? '+' : ''}${n}</span>`;
  $('#logSub').textContent = re && v.phase === 'roundEnd' ? 'Runda ' + re.round + ' · konec' : 'Dnevnik · runda ' + v.round;
  $('#logT').textContent = re && v.phase === 'roundEnd' ? (re.winner === v.me.seat ? 'Ti si šel ven' : v.players[re.winner].name + ' je šel ven') : 'Točke do zdaj';
  const all = v.rounds; const tot = v.players.map((p) => p.score); const lead = Math.max(...tot);
  $('#pts').innerHTML = `<thead><tr><th>Runda</th>${v.players.map((p) => `<th class="num"><i class="dot" style="background:${COLORS[p.seat]}"></i>${esc(p.name)}</th>`).join('')}</tr></thead><tbody>${all.length ? all.map((r, i) => `<tr class="${i === all.length - 1 && v.phase === 'roundEnd' ? 'cur' : ''}"><td>${i + 1}</td>${r.map((n) => `<td class="num">${f(n)}</td>`).join('')}</tr>`).join('') : '<tr><td colspan="5" class="small-note">Prva runda še teče.</td></tr>'}</tbody><tfoot><tr><td>Skupaj <small>/ ${v.goal}</small></td>${tot.map((n) => `<td class="num ${n === lead && all.length ? 'lead' : ''}">${n}</td>`).join('')}</tr></tfoot>`;
  const mini = (cs) => cs.length ? cs.map((c) => cardEl(c, 'xs').outerHTML).join('') : '<em>nič</em>';
  $('#cards').innerHTML = re ? re.rows.map((r) => { const p = v.players[r.seat]; return `<div class="cr"><div class="cr-h"><i class="dot" style="background:${COLORS[r.seat]}"></i><b>${esc(p.name)}</b><span class="mono">${f(r.table)} miza · ${f(-r.hand)} roka</span><b class="cr-sum ${r.hand ? 'neg' : 'pos'}">${r.hand ? '-' + r.hand : '0'} v roki</b></div><div class="cr-l"><span class="mono">Miza</span><div class="cs">${mini(r.tableCards)}</div></div><div class="cr-l"><span class="mono">Roka</span><div class="cs">${mini(r.handCards)}</div></div></div>`; }).join('') : '<p class="small-note">Karte se pokažejo ob koncu runde.</p>';
  const rn = v.players.filter((p) => p.ready).length; $('#readyN').textContent = rn; $('#readyT').textContent = v.players.length;
  const inEnd = v.phase === 'roundEnd' && v.status === 'playing';
  $('#readys').innerHTML = inEnd ? v.players.map((p) => `<button class="ready ${p.ready ? 'on' : ''}" ${p.seat === v.me.seat && !p.ready ? 'data-me="1"' : 'disabled'}>${p.seat === v.me.seat ? 'Ti · Ready' : esc(p.name)}</button>`).join('') : '';
  const meBtn = $('#readys [data-me]'); if (meBtn) meBtn.onclick = () => call({ action: 'ready' });
  $('#logClose').hidden = inEnd; $('#cnt').hidden = true;
  if (!inEnd && auto) { o.hidden = true; }
}
$$('#log [data-t]').forEach((b) => (b.onclick = () => { $$('#log [data-t]').forEach((x) => x.setAttribute('aria-pressed', x === b)); $('#pts').hidden = b.dataset.t !== 'pts'; $('#cards').hidden = b.dataset.t !== 'cards'; }));

/* ================= animacije ================= */
const EASE = 'cubic-bezier(.2,.8,.2,1)';
function rectOf(el) { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }
S.flying = new Set();
function fly(node, from, to, { dur = 520, delay = 0, rot = 0 } = {}) {
  const fid = node && node.dataset ? node.dataset.id : null; if (fid) S.flying.add(fid);
  return new Promise((res) => { const g = node.cloneNode(true); g.classList.add('ghost'); g.style.cssText += `;position:fixed;left:${from.x}px;top:${from.y}px;width:${from.w}px;height:${from.h}px;--cw:${from.w}px;--ch:${from.h}px;margin:0;z-index:80;pointer-events:none;transform:none;transform-origin:0 0;visibility:visible`; document.body.appendChild(g);
    const dx = to.x - from.x, dy = to.y - from.y, sx = to.w / from.w, sy = to.h / from.h;
    g.animate([{ transform: 'translate(0,0) rotate(0deg)' }, { transform: `translate(${dx * .5}px,${dy * .5 - 40}px) rotate(${rot}deg) scale(${(1 + sx) / 2},${(1 + sy) / 2})`, offset: .5 }, { transform: `translate(${dx}px,${dy}px) rotate(0deg) scale(${sx},${sy})` }], { duration: dur, delay, easing: EASE, fill: 'forwards' }).onfinish = () => { g.remove(); if (fid) { S.flying.delete(fid); $$(`.meld .card[data-id="${CSS.escape(fid)}"], #hand .card[data-id="${CSS.escape(fid)}"]`).forEach((e) => (e.style.visibility = '')); } res(); }; });
}
function flipHand(before) { $$('#hand .card').forEach((e) => { const o = before.get(e.dataset.id); if (!o) return; const n = e.getBoundingClientRect(); const dx = o.left - n.left, dy = o.top - n.top; if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return; e.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'translate(0,0)' }], { duration: 380, easing: EASE }); }); }
function dealAnim() {
  const deck = $('#pDeck .stack'); if (!deck || document.body.dataset.screen !== 'game') return; const dr = rectOf(deck);
  const mine = $$('#hand .card'); mine.forEach((e) => (e.style.visibility = 'hidden'));
  const zones = $$('.zone:not([hidden])').filter((z) => z.dataset.z !== 'me'); let k = 0;
  for (let i = 0; i < 6; i++) { [null, ...zones].forEach((z) => { const delay = k++ * 55;
    if (!z) { const e = mine[i]; if (!e) return; fly(backEl(), dr, rectOf(e), { delay, dur: 420, rot: -12 }).then(() => { e.style.visibility = ''; e.animate([{ transform: 'rotateY(90deg)' }, { transform: 'none' }], { duration: 180 }); }); }
    else { const av = z.querySelector('.av'); if (!av) return; const zr = rectOf(av); fly(backEl(), dr, { x: zr.x + 40 + i * 4, y: zr.y - 8, w: dr.w * .4, h: dr.h * .4 }, { delay, dur: 420, rot: -12 }); } }); }
  setTimeout(() => mine.forEach((e) => (e.style.visibility = '')), k * 55 + 600);
}
/* drag & drop iz roke */
(function () { let drag = null;
  document.addEventListener('pointerdown', (e) => { const c = e.target.closest('#hand .card'); if (!c || e.button !== 0) return; drag = { id: c.dataset.id, x: e.clientX, y: e.clientY, ghost: null, moved: false }; });
  document.addEventListener('pointermove', (e) => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved) { if (Math.hypot(dx, dy) < 8) return; drag.moved = true; S.sel.clear(); S.order = []; if (!needDraw()) toggleSel(drag.id); else render();
      const el = $(`#hand .card[data-id="${CSS.escape(drag.id)}"]`); const r = el.getBoundingClientRect(); drag.ox = e.clientX - r.left; drag.oy = e.clientY - r.top; drag.ghost = el.cloneNode(true); drag.ghost.classList.add('ghost', 'drag'); drag.ghost.classList.remove('sel'); drag.ghost.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;z-index:90;pointer-events:none;transform:rotate(-4deg) scale(1.05)`; document.body.appendChild(drag.ghost); el.style.visibility = 'hidden'; document.body.classList.add('dragging'); }
    drag.ghost.style.left = (e.clientX - drag.ox) + 'px'; drag.ghost.style.top = (e.clientY - drag.oy) + 'px';
    $$('.drop-over').forEach((x) => x.classList.remove('drop-over')); const t = document.elementFromPoint(e.clientX, e.clientY); const tgt = t && (t.closest('.pad') || t.closest('.meld.can') || t.closest('#pDis') || (t.closest('#hand .card') && t.closest('#hand .card').dataset.id !== drag.id ? t.closest('#hand .card') : null)); if (tgt) tgt.classList.add('drop-over'); });
  document.addEventListener('pointerup', (e) => { if (!drag) return; const d = drag; drag = null; if (!d.moved) return;
    d.ghost.remove(); document.body.classList.remove('dragging'); $$('.drop-over').forEach((x) => x.classList.remove('drop-over'));
    const el = $(`#hand .card[data-id="${CSS.escape(d.id)}"]`); if (el) el.style.visibility = '';
    const t = document.elementFromPoint(e.clientX, e.clientY); if (!t) return;
    const pad = t.closest('.pad'); const meld = t.closest('.meld'); const dis = t.closest('#pDis');
    const hc = t.closest('#hand .card');
    if (pad && meld) doAdd(+meld.dataset.mi, pad.dataset.side); else if (meld && meld.classList.contains('swapable')) doAdd(+meld.dataset.mi, 'swap'); else if (meld && meld.classList.contains('can')) doAdd(+meld.dataset.mi); else if (dis && !$('#bDis').disabled) doDiscard();
    else if (hc && hc.dataset.id !== d.id) { const r = hc.getBoundingClientRect(); const after = e.clientX > r.left + r.width / 2; const o = S.handOrder.filter((x) => x !== d.id); let idx = o.indexOf(hc.dataset.id) + (after ? 1 : 0); o.splice(idx, 0, d.id); S.handOrder = o; S.sel.clear(); S.order = []; render(); }
    else if (t.closest('#hand') || t.closest('.me')) { S.sel.clear(); S.order = []; render(); } });
  // na telefonu lahko brskalnik prekine vlečenje (npr. drsenje strani): počisti
  document.addEventListener('pointercancel', () => { if (!drag) return; const d = drag; drag = null; if (d.ghost) d.ghost.remove(); document.body.classList.remove('dragging'); $$('.drop-over').forEach((x) => x.classList.remove('drop-over')); const el = $(`#hand .card[data-id="${CSS.escape(d.id)}"]`); if (el) el.style.visibility = ''; });
})();
/* ozadje: poligoni, nariše se enkrat */
function drawBg() { const c = $('#bg canvas'), x = c.getContext('2d'); function d() { c.width = innerWidth; c.height = innerHeight; x.clearRect(0, 0, c.width, c.height); const pts = []; for (let i = 0; i < 70; i++) pts.push([Math.random() * c.width, Math.random() * c.height]); x.strokeStyle = 'rgba(70,190,197,.07)'; x.lineWidth = 1; pts.forEach((p, i) => { pts.slice(i + 1).forEach((q) => { const dd = Math.hypot(p[0] - q[0], p[1] - q[1]); if (dd < 190) { x.beginPath(); x.moveTo(p[0], p[1]); x.lineTo(q[0], q[1]); x.stroke(); } }); }); } d(); addEventListener('resize', d); }

boot();
window.__S = S;

/* ================= cekini, trgovina, dnevni izziv ================= */
const SHOP = [
  { id: 'back_classic', kind: 'back', name: 'foqs. klasika', price: 0 }, { id: 'back_night', kind: 'back', name: 'Modra noč', price: 300 },
  { id: 'back_wine', kind: 'back', name: 'Rdeči žamet', price: 300 }, { id: 'back_gold', kind: 'back', name: 'Zlati hrbet', price: 400 },
  { id: 'back_markec', kind: 'back', name: 'Markčev hrbet', price: 0, locked: 'Premagaj šefa Markca (Ambrus)' },
  { id: 'back_jozi', kind: 'back', name: 'Jožin hrbet', price: 0, locked: 'Premagaj šefico Joži (Zagradec)' },
  { id: 'face_classic', kind: 'face', name: 'Klasične karte', price: 0 }, { id: 'face_big', kind: 'face', name: 'Velike številke', price: 500, note: 'Ogromne številke, lažje berljivo.' },
];
const DAILY_REW = [10, 15, 20, 25, 30, 40, 80];
function applyLook(w) { const b = document.body.classList; ['back-gold', 'back-night', 'back-wine', 'back-markec', 'back-jozi', 'face-big'].forEach((c) => b.remove(c)); if (!w) return; if (w.back && w.back !== 'classic') b.add('back-' + w.back); if (w.face === 'big') b.add('face-big'); }
function setCoins(n, bump) { $('#coinN').textContent = n; $('#shopN').textContent = n; if (bump) { const c = $('#coinChip'); c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); } }
async function loadWallet() {
  const r = await call({ action: 'wallet' }, { quiet: true }); if (!r || !r.wallet) return;
  S.wallet = r.wallet; S.walletInfo = r; setCoins(r.wallet.coins); applyLook(r.wallet); renderToday();
  if (r.dailyAvail && !S.dailyShown && document.body.dataset.screen === 'lobby') { S.dailyShown = true; showDailyReward(r.nextDaily); }
}
function showDailyReward(nd) {
  const s = nd.streak; const nm = myName().split(' ')[0];
  $('#mDaily h2').textContent = s === 7 ? '7. dan zapored, skrinjica je tvoja!' : s > 1 ? s + '. dan zapored, kar tako naprej!' : 'Ej ' + nm + ', lepo te je videt!';
  $('#mDaily .small-note').textContent = s === 7 ? 'Pravi mojster. Jutri začneš nov krog, nagrade pa spet rastejo.' : 'Cekini za danes te že čakajo. Pridi tudi jutri, nagrada bo še večja, 7. dan pa te čaka skrinjica.'; $('#dStreak').innerHTML = DAILY_REW.map((n, i) => `<div class="d ${i + 1 < s ? 'done' : i + 1 === s ? 'now' : ''} ${i === 6 ? 'chest' : ''}"><small>${i === 6 ? 'Skrinjica' : 'Dan ' + (i + 1)}</small><b>${n}</b></div>`).join('');
  $('#dClaim').innerHTML = `Daj sem <span class="coin">Q</span> +${nd.amount}`; $('#dClaim').disabled = false; $('#mDaily').hidden = false;
}
$('#dClaim').onclick = async () => { const b = $('#dClaim'); b.disabled = true; const r = await call({ action: 'claim_daily' }, { quiet: true }); if (!r) { b.disabled = false; return toast('Ni uspelo, poskusi znova', 'bad'); }
  const from = rectOf(b); $('#mDaily').hidden = true; S.wallet = r.wallet; S.walletInfo && (S.walletInfo.dailyAvail = false);
  coinFly(from, $('#coinChip'), r.claim && r.claim.ok ? 6 : 0, () => setCoins(r.wallet.coins, true)); if (r.claim && r.claim.ok) toast('+' + r.claim.amount + ' cekinov, ' + r.claim.streak + '. dan zapored. Super!', 'ok'); renderToday(); };
function coinFly(fromRect, toEl, n, done) {
  if (!n || !toEl) { done && done(); return; } const to = rectOf(toEl); let left = n;
  for (let i = 0; i < n; i++) { const e = document.createElement('div'); e.className = 'coin-fly'; e.innerHTML = '<span class="coin">Q</span>'; const x0 = fromRect.x + fromRect.w / 2 + (Math.random() - 0.5) * 60, y0 = fromRect.y + fromRect.h / 2 + (Math.random() - 0.5) * 20; e.style.left = x0 + 'px'; e.style.top = y0 + 'px'; document.body.appendChild(e);
    e.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${(to.x + to.w / 2 - x0) * 0.5}px,${(to.y - y0) * 0.5 - 60}px) scale(1.2)`, opacity: 1, offset: 0.5 }, { transform: `translate(${to.x + 14 - x0}px,${to.y + to.h / 2 - 11 - y0}px) scale(.7)`, opacity: 0.9 }], { duration: 700, delay: i * 70, easing: EASE, fill: 'forwards' }).onfinish = () => { e.remove(); if (--left === 0) done && done(); }; }
}
function coinPop(n, label) {
  const h = $('#hand'); const r = h ? rectOf(h) : { x: innerWidth / 2, y: innerHeight / 2, w: 0, h: 0 };
  const e = document.createElement('div'); e.className = 'coin-pop'; e.innerHTML = `<span class="coin">Q</span>+${n} <small>${esc(label)}</small>`; e.style.left = r.x + r.w / 2 + 'px'; e.style.top = Math.max(80, r.y - 10) + 'px'; document.body.appendChild(e); setTimeout(() => e.remove(), 2000);
  const g = $('#gCoinWrap'); g.classList.remove('bump'); void g.offsetWidth; g.classList.add('bump');
}
function renderAward(v) {
  const a = v.me && v.me.award; const el = $('#finAw');
  if (!a) { el.innerHTML = ''; return; }
  el.innerHTML = a.parts.map((x) => `<div class="row"><span>${esc(x.label)}</span><b>+${x.n}</b></div>`).join('') +
    `<div class="row tot"><span>Dobil si</span><b><span class="coin">Q</span>+${a.credited}</b></div>` +
    (a.limited ? '<p class="nt">Danes si že odigral 3 igre brez prijateljev, zato za to igro ni cekinov. Igre s prijatelji štejejo vedno.</p>' : a.solo ? '<p class="nt">Igra brez prijateljev: polovica cekinov (največ 3 take igre na dan).</p>' : '');
}
const WD = ['ned', 'pon', 'tor', 'sre', 'čet', 'pet', 'sob'];
async function renderToday() {
  const el = $('#today'); const info = S.walletInfo; if (!el || !info) return;
  const w = info.wallet || S.wallet; const nm = myName().split(' ')[0]; const dr = info.dailyResult; const day = info.today;
  // dnevne nagrade za danes in naslednjih 6 dni
  const avail = info.dailyAvail; const sToday = avail ? info.nextDaily.streak : (w.streak || 1);
  const base = new Date(day + 'T12:00:00');
  const cells = Array.from({ length: 7 }, (_, i) => { const st = ((sToday - 1 + i) % 7) + 1; const d = new Date(base.getTime() + i * 864e5); const lbl = i === 0 ? 'Danes' : i === 1 ? 'Jutri' : WD[d.getDay()];
    return `<div class="rd ${i === 0 ? (avail ? 'now' : 'got') : ''} ${st === 7 ? 'chest' : ''}"><small>${lbl}</small><b><span class="coin">Q</span>${DAILY_REW[st - 1]}</b>${st === 7 ? '<em>skrinjica</em>' : ''}${i === 0 && !avail ? '<i class="ok">✓</i>' : ''}</div>`; }).join('');
  // dnevni izziv
  let top = [];
  if (MOCK) top = [{ name: 'Jaka', score: 85, user_id: 'b1' }, { name: 'Maja', score: 40, user_id: 'b3' }].concat(dr && dr.score != null ? [{ name: 'Gašper', score: dr.score, user_id: 'me' }] : []).sort((a, b) => b.score - a.score);
  else { const { data } = await sb.from('romi_daily_results').select('name,score,user_id').eq('day', day).not('score', 'is', null).order('score', { ascending: false }).limit(5); top = data || []; }
  const board = top.length ? '<div class="dl">' + top.map((t, i) => `<div class="${t.user_id === S.user.id ? 'you' : ''}"><em>${i + 1}.</em>${esc(t.name)} <b>${t.score}</b></div>`).join('') + '</div>' : '';
  const dDone = dr && dr.score != null; const myRank = dDone ? top.findIndex((t) => t.user_id === S.user.id) + 1 : 0;
  let chal;
  if (!dr) chal = `<div class="tc chal hot"><span class="badge">Še čaka nate</span><span class="mono">Dnevni izziv · ${WD[base.getDay()]} ${base.getDate()}. ${base.getMonth() + 1}.</span><h3>Ista mešanica kart za vse. Kdo jo odigra najbolje?</h3><p>Ena runda proti dvema nasprotnikoma, okoli 5 minut. Vsi danes dobijo iste karte, šteje samo, kako igraš.</p><div class="rw"><span>+20 odigran</span><span>+30 zmaga</span><span>+25 najboljši dneva</span></div><button class="btn pri big" id="bDaily">Sprejmem izziv</button>${board}</div>`;
  else if (!dDone) chal = `<div class="tc chal"><span class="badge off">Nedokončan</span><span class="mono">Dnevni izziv</span><h3>Danes ni šlo do konca</h3><p>Nič hudega, jutri te čaka nova mešanica kart.</p>${board}</div>`;
  else chal = `<div class="tc chal done"><span class="badge ok">Opravljeno ✓</span><span class="mono">Dnevni izziv</span><h3>Tvoj rezultat: ${dr.score} točk</h3><p>${top.length < 2 ? 'Zaenkrat si edini. Povej prijateljem, naj te poskusijo premagati.' : myRank === 1 ? 'Trenutno vodiš. Če zdržiš do polnoči, dobiš še +25 cekinov.' : 'Na ' + myRank + '. mestu si. Vodi ' + esc(top[0].name) + ' s ' + top[0].score + ' točkami.'}</p>${board}</div>`;
  // dnevne naloge
  const tasks = info.tasks || []; const nDone = tasks.filter((t) => t.claimed).length; const allC = info.tasksBonus && info.tasksBonus.claimed;
  const trows = tasks.map((t) => `<div class="tk ${t.claimed ? 'claimed' : t.progress >= t.target ? 'can' : ''}"><div class="tk-t"><span>${esc(t.label)}</span><div class="bar"><i style="width:${Math.round(t.progress / t.target * 100)}%"></i></div><small>${t.progress}/${t.target}</small></div>${t.claimed ? '<span class="tk-ok">✓</span>' : t.progress >= t.target ? `<button class="btn pri" data-task="${t.key}">Poberi +${t.reward}</button>` : `<span class="tk-rw"><span class="coin">Q</span>${t.reward}</span>`}</div>`).join('');
  const tcard = `<div class="tc tasks ${allC ? 'done' : nDone < tasks.length ? 'hot2' : ''}"><span class="badge ${allC ? 'ok' : ''}">${allC ? 'Vse opravljeno ✓' : nDone + '/' + tasks.length + ' opravljeno'}</span><span class="mono">Dnevne naloge</span><h3>${allC ? 'Mašina! Jutri nove naloge.' : 'Trije mali cilji za danes'}</h3><p>Vsaka +15, vse tri še bonus +${info.tasksBonus ? info.tasksBonus.amount : 20}. Štejejo vse igre.</p>${trows}</div>`;
  // pozdrav
  const head = avail ? ['Ej ' + nm + ', lepo te je videt!', 'Dnevni cekini te že čakajo. Poberi jih, potem pa pokaži kartam, kdo je šef.'] : !dr ? ['Ej ' + nm + ', a greš na današnji izziv?', 'Ista mešanica kart za vse. Danes je lahko tvoj dan.'] : !allC ? ['Dobro ti gre, ' + nm + '!', 'Še malo do vseh nalog. Vsaka igra šteje.'] : ['Šef, ' + nm + '!', 'Za danes si vse opravil. Jutri pridi po novo nagrado, niz te čaka.'];
  // kampanja
  const C = S.camp || { stars: {}, total: 0 }; const NL = E.CAMPAIGN.levels.length; const won = E.CAMPAIGN.levels.filter((l) => (C.stars[l.n] || 0) > 0).length; const nextLv = Math.min(NL, won + 1); const nch = chOf(nextLv);
  const camp = `<div class="tc campc"><div><span class="mono">Kampanja · Poglavje ${nch.n} - ${esc(nch.place)} · ${esc(nch.venue)}</span><h3>${won >= NL ? 'Vsa poglavja premagana! Lovi še vse zvezdice.' : won ? 'Nivo ' + nextLv + ' te čaka: ' + esc(E.CAMPAIGN.levels[nextLv - 1].title) : 'Preizkusi se na popotovanju po krajih, od gostilne do gostilne'}</h3><p>${won}/${NL} nivojev · <b class="st">★ ${C.total}/${NL * 3}</b></p></div><button class="btn pri" id="bCamp">${won ? 'Nadaljuj kampanjo' : 'Začni kampanjo'}</button></div>`;
  el.innerHTML = `<div class="td-hi"><div><h2>${esc(head[0])}</h2><p>${head[1]}</p></div><div class="rew"><div class="rew-h"><span class="mono">Dnevne nagrade · ${w.streak || 0} ${(w.streak || 0) === 1 ? 'dan' : (w.streak || 0) === 2 ? 'dneva' : 'dni'} zapored</span>${avail ? `<button class="btn pri" id="bClaim">Poberi +${info.nextDaily.amount}</button>` : '<span class="small-note">Danes pobrano, pridi jutri</span>'}</div><div class="rds">${cells}</div></div></div><div class="td-row">${chal}${tcard}</div>${camp}`;
  const b = $('#bDaily'); if (b) b.onclick = startDaily;
  const bc = $('#bClaim'); if (bc) bc.onclick = () => showDailyReward(info.nextDaily);
  $('#bCamp').onclick = openCampaign;
  $$('#today [data-task]').forEach((x) => (x.onclick = async () => { x.disabled = true; const r = await call({ action: 'claim_task', key: x.dataset.task }, { quiet: true }); if (!r) { x.disabled = false; return toast('Ni uspelo, poskusi znova', 'bad'); } coinFly(rectOf(x), $('#coinChip'), r.claim.bonus ? 8 : 4, () => setCoins(r.wallet.coins, true)); toast(r.claim.bonus ? '+15 in bonus +' + r.claim.bonus + '! Vse naloge opravljene.' : '+15 cekinov, naloga opravljena', 'ok'); loadWallet(); }));
}
/* ================= kampanja ================= */
const BOSS_BACK = { back_markec: 'Markčev hrbet', back_jozi: 'Jožin hrbet' };
const ACC = { Markec: 'Markca', 'Joži': 'Joži' }; const acc = (n) => ACC[n] || n;
const chOf = (n) => E.CAMPAIGN.chapters.find((c) => n >= c.from && n <= c.to);
const bossOf = (ch) => E.CAMPAIGN.levels.find((l) => l.n === ch.to);
async function loadCamp() { const r = await call({ action: 'campaign_info' }, { quiet: true }); if (r) S.camp = r; return r; }
const NODE_POS = [[8, 84], [26, 76], [44, 84], [62, 76], [82, 70], [72, 46], [52, 50], [32, 44], [14, 26], [50, 14]];
async function openCampaign() {
  unwake(); show('camp'); $('#campCoins b').textContent = S.wallet ? S.wallet.coins : 0;
  await loadCamp(); const C = S.camp || { stars: {} }; const won = (n) => (C.stars[n] || 0) > 0;
  const firstOpen = E.CAMPAIGN.levels.find((l) => !won(l.n)); S.campSel = S.campSel || (firstOpen ? firstOpen.n : E.CAMPAIGN.levels.length);
  const mobMap = document.body.classList.contains('mob'); const NP = NODE_POS.map(([x, y]) => [x, mobMap ? 26 + y * 0.72 : y]); const pts = NP.map(([x, y]) => x + ',' + y).join(' '); const ch = chOf(S.campSel); const lvls = E.CAMPAIGN.levels.filter((l) => l.ch === ch.n);
  $('#campSub').textContent = 'Kampanja · Poglavje ' + ch.n + ' - ' + ch.place;
  const tabs = '<div class="ch-tabs">' + E.CAMPAIGN.chapters.map((c) => { const open = c.from === 1 || won(c.from - 1); const n = E.CAMPAIGN.levels.filter((l) => l.ch === c.n && won(l.n)).length; return `<button class="${c.n === ch.n ? 'on' : ''} ${open ? '' : 'lock'}" data-ch="${c.n}" ${open ? '' : 'title="Najprej premagaj šefa prejšnjega poglavja"'}><small>Poglavje ${c.n}</small>${esc(c.place)}<em>${open ? n + '/10' : 'zaklenjeno'}</em></button>`; }).join('') + '<button class="soon" disabled><small>Poglavje ' + (E.CAMPAIGN.chapters.length + 1) + '</small>Kmalu …<em>nova postaja</em></button></div>';
  $('#campMap').innerHTML = `${tabs}<div class="ch-t"><span class="mono">Poglavje ${ch.n} - ${esc(ch.place)}</span><b>${esc(ch.venue)}</b></div><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="rgba(70,190,197,.35)" stroke-width="1" stroke-dasharray="1 2.4" vector-effect="non-scaling-stroke" stroke-linecap="round" style="stroke-width:3px"/></svg>` +
    lvls.map((l, i) => { const st = C.stars[l.n] || 0; const open = l.n === 1 || won(l.n - 1); const cls = st ? 'done' : open ? 'now' : 'lock';
      return `<button class="node ${cls} ${l.boss ? 'boss' : ''} ${S.campSel === l.n ? 'sel' : ''}" data-lv="${l.n}" style="left:${NP[i][0]}%;top:${NP[i][1]}%"><b>${l.boss ? '♛' : l.n}</b><span class="st">${st ? '★'.repeat(st) + '☆'.repeat(3 - st) : l.boss ? l.boss + ' ' + esc(l.bots[0][0]) : ''}</span></button>`; }).join('');
  $$('#campMap .node').forEach((n) => (n.onclick = () => { S.campSel = +n.dataset.lv; openCampaign(); }));
  $$('#campMap .ch-tabs [data-ch]').forEach((b) => (b.onclick = () => { if (b.classList.contains('lock')) return toast('Najprej premagaj šefa prejšnjega poglavja'); const c = E.CAMPAIGN.chapters[+b.dataset.ch - 1]; const fo = E.CAMPAIGN.levels.find((l) => l.ch === c.n && !won(l.n)); S.campSel = fo ? fo.n : c.from; openCampaign(); }));
  const l = E.CAMPAIGN.levels[S.campSel - 1]; const st = C.stars[l.n] || 0; const open = l.n === 1 || won(l.n - 1);
  const bb = l.unlock ? l.unlock.split('_')[1] : '';
  $('#campLvl').innerHTML = `<span class="mono">Nivo ${l.n}${l.boss ? ' · ' + l.boss + ' poglavja' : ''} · ${esc(ch.venue)}</span><h3>${esc(l.title)}</h3>
    <div class="cbots">${l.bots.map(([nm, lv], i) => `<div class="cb"><span class="av" style="background:${COLORS[i + 1]};color:#0d2c2e">${ini(nm)}</span><div><b>${esc(nm)}</b><small>${E.BOT_LEVELS[lv]} · ${'●'.repeat(lv)}${'○'.repeat(4 - lv)}</small></div></div>`).join('')}</div>
    <div class="crows"><div><span>Igra do</span><b>${l.goal} točk</b></div><div><span>Nagrada prvič</span><b><span class="coin">Q</span>${l.coins}</b></div><div><span>Vsaka nova zvezdica</span><b><span class="coin">Q</span>10</b></div>${l.unlock ? '<div><span>Odklene</span><b>' + BOSS_BACK[l.unlock] + '</b></div>' : ''}</div>
    <div class="cstars"><div class="${st >= 1 ? 'on' : ''}"><b>★</b>zmagaš</div><div class="${st >= 2 ? 'on' : ''}"><b>★★</b>zmagaš za 50+ točk</div><div class="${st >= 3 ? 'on' : ''}"><b>★★★</b>zmagaš za 100+ točk</div></div>
    ${l.unlock ? `<div class="cunl"><div class="card back v-${bb} pvc"><i class="q"></i></div><span>Premagaj ${l.boss === 'šefica' ? 'šefico' : 'šefa'} ${esc(acc(l.bots[0][0]))} in dobiš ${BOSS_BACK[l.unlock]} kart, ki ga v trgovini ni.</span></div>` : ''}
    <label class="cnt-t"><input type="checkbox" id="campNoTimer" ${S.campNoTimer ? 'checked' : ''}> Igraj brez štoparice (v svojem ritmu)</label>
    <button class="btn pri big" id="campPlay" ${open ? '' : 'disabled'}>${open ? (st ? 'Igraj znova' : 'Igraj nivo ' + l.n) : 'Najprej premagaj nivo ' + (l.n - 1)}</button>
    <p class="small-note">Namig v igri stane 20 cekinov in pokaže možno kombinacijo.</p>`;
  $('#campNoTimer').onchange = (e) => (S.campNoTimer = e.target.checked);
  $('#campPlay').onclick = () => startCampaign(l.n);
  const top = (C.top || []).filter((t) => t.total > 0);
  $('#campTop').innerHTML = `<div class="lb-h"><span class="mono">Lestvica kampanje</span><span class="mono lb-sub">zvezdice</span></div>` + (top.length ? '<div class="ctl">' + top.map((t, i) => `<div class="${t.user_id === S.user.id ? 'you' : ''}"><em>${i + 1}.</em>${esc(t.name)}<b>★ ${t.total}</b></div>`).join('') + '</div>' : '<p class="small-note">Še nihče nima zvezdic. Bodi prvi!</p>');
}
async function startCampaign(n) {
  const r = await call({ action: 'campaign_start', level: n, noTimer: !!S.campNoTimer }); if (!r || !r.room) return;
  unsubscribeRoom(); S.room = r.room; S.players = []; S.lastCamp = n; if (!MOCK) subscribeRoom(r.room.id, () => refreshRoom()); startGame();
}
$('#campBack').onclick = () => enterLobby();
$('#bHint').onclick = async () => { const r = await call({ action: 'hint' }); if (!r) return; if (!r.hint) return toast('Ni očitne poteze. Razmisli, kaj boš zavrgel.');
  S.sel = new Set(r.hint.ids); S.order = [...r.hint.ids]; render(); if (S.wallet) S.wallet.coins -= 20;
  if (r.hint.type === 'add') { const t = $(`.meld[data-mi="${r.hint.meld}"]`); if (t) t.animate([{ boxShadow: '0 0 0 0 rgba(240,195,90,.8)' }, { boxShadow: '0 0 0 16px rgba(240,195,90,0)' }], { duration: 900, iterations: 2 }); toast('Namig: dodaj izbrano karto k označeni kombinaciji', 'ok'); }
  else toast('Namig: izbrane karte so kombinacija, klikni Položi', 'ok'); };
async function startDaily() {
  const r = await call({ action: 'daily_start' }); if (!r || !r.room) return;
  unsubscribeRoom(); S.room = r.room; S.players = []; if (!MOCK) subscribeRoom(r.room.id, () => refreshRoom()); startGame();
}
$('#coinChip').onclick = () => openShop();
$('#shopX').onclick = () => ($('#mShop').hidden = true);
$('#mShop').addEventListener('click', (e) => { if (e.target.id === 'mShop') $('#mShop').hidden = true; });
function openShop() { renderShop(); $('#mShop').hidden = false; }
function renderShop() {
  const w = S.wallet || { coins: 0, owned: ['back_classic', 'face_classic'], back: 'classic', face: 'classic' }; setCoins(w.coins);
  $('#shopList').innerHTML = SHOP.filter((it) => !it.locked || w.owned.includes(it.id) || true).map((it) => { const own = w.owned.includes(it.id); const eq = w[it.kind] === it.id.split('_')[1];
    const pv = it.kind === 'back' ? `<div class="card back pvc ${it.id === 'back_classic' ? '' : 'v-' + it.id.split('_')[1]}"><i class="q"></i></div>` : `<div class="${it.id === 'face_big' ? 'fbig' : 'fcl'}">${cardEl('7♥').outerHTML}</div>`;
    const btn = eq ? '<button class="btn" disabled>Izbrano ✓</button>' : own ? `<button class="btn" data-eq="${it.id}">Izberi</button>` : it.locked ? `<button class="btn" disabled>${esc(it.locked)}</button>` : w.coins >= it.price ? `<button class="btn pri" data-buy="${it.id}">Kupi</button>` : `<button class="btn" disabled>Manjka ${it.price - w.coins}</button>`;
    return `<div class="si ${eq ? 'eq' : ''}"><div class="pv">${pv}</div><b>${esc(it.name)}</b>${it.price && !own ? `<span class="pr"><span class="coin">Q</span>${it.price}</span>` : `<span class="pr" style="color:var(--pos)">${own ? 'v lasti' : ''}</span>`}${btn}</div>`; }).join('');
  $$('#shopList [data-buy]').forEach((b) => (b.onclick = async () => { const it = SHOP.find((x) => x.id === b.dataset.buy); if (!confirm('Kupiš "' + it.name + '" za ' + it.price + ' cekinov?')) return; const r = await call({ action: 'buy', item: it.id }); if (!r) return; const r2 = await call({ action: 'equip', item: it.id }); S.wallet = (r2 || r).wallet; applyLook(S.wallet); renderShop(); toast('Kupljeno in izbrano: ' + it.name, 'ok'); }));
  $$('#shopList [data-eq]').forEach((b) => (b.onclick = async () => { const r = await call({ action: 'equip', item: b.dataset.eq }); if (!r) return; S.wallet = r.wallet; applyLook(S.wallet); renderShop(); }));
}

/* ================= lestvica ================= */
async function loadLeaderboard() {
  const el = $('#lbBody'); if (!el) return;
  let rows = [];
  if (MOCK) rows = [{ name: 'Gašper', points: 1240, games: 6, wins: 3 }, { name: 'Jaka', points: 980, games: 6, wins: 2 }, { name: 'Nejc', points: 410, games: 3, wins: 1 }];
  else { const { data } = await sb.from('romi_stats').select('*').order('points', { ascending: false }).limit(20); rows = data || []; }
  if (!rows.length) { el.innerHTML = '<span class="small-note">Še ni zaključenih iger. Štejejo samo igre, odigrane do 500 točk.</span>'; return; }
  el.innerHTML = '<ol class="lbl">' + rows.map((r, i) => `<li class="${r.user_id === S.user?.id ? 'you' : ''} ${i < 3 ? 'top' + (i + 1) : ''}"><span class="lb-rank">${i + 1}</span><span class="lb-name">${esc(r.name)}<small>${r.games} ${r.games === 1 ? 'igra' : r.games === 2 ? 'igri' : r.games < 5 ? 'igre' : 'iger'} · ${r.wins} ${r.wins === 1 ? 'zmaga' : r.wins === 2 ? 'zmagi' : r.wins > 2 && r.wins < 5 ? 'zmage' : 'zmag'}</small></span><span class="lb-pts">${r.points}<small>točk</small></span></li>`).join('') + '</ol><p class="lb-note">Štejejo samo igre, odigrane do 500 točk.</p>';
}

window.__call = call; window.__doLay = doLay; window.__doDiscard = doDiscard; window.__render = render;
