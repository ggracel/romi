// @ts-nocheck
// foqs.romi: vsa logika igre teče tukaj. Klient pošlje akcijo, strežnik preveri pravila in vrne pogled igralca (brez tujih kart).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as E from "./engine.js";

const ORIGINS = new Set(["https://foqs.si", "https://www.foqs.si", "https://ggracel.github.io", "http://127.0.0.1:4173", "http://localhost:4173", "http://127.0.0.1:5500", "http://localhost:5500"]);
function cors(origin) {
  return { "Access-Control-Allow-Origin": ORIGINS.has(origin) ? origin : "https://foqs.si", "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin", "Cache-Control": "no-store" };
}
const admin = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));

async function bump(roomId, patch = {}) {
  await admin.rpc("romi_bump", { p_room: roomId, p_status: patch.status ?? null });
}
async function loadGame(roomId) {
  const { data } = await admin.from("romi_games").select("state").eq("room_id", roomId).single();
  return data?.state ?? null;
}
async function saveGame(roomId, g) {
  await admin.from("romi_games").upsert({ room_id: roomId, state: g, updated_at: new Date().toISOString() });
}
async function room(roomId) {
  const { data } = await admin.from("romi_rooms").select("*").eq("id", roomId).single();
  if (!data) throw ue("Soba ne obstaja več.");
  return data;
}
async function players(roomId) {
  const { data } = await admin.from("romi_players").select("*").eq("room_id", roomId).order("seat");
  return data ?? [];
}
// trgovina: cene so samo na strežniku
const SHOP = { back_classic: 0, face_classic: 0, back_markec: 0, back_jozi: 0, back_gold: 400, back_night: 300, back_wine: 300, face_big: 500 };
// dnevne naloge: vsak dan 3 (enake za vse), vsaka +15, vse tri +20
const TASKS = {
  play1: { label: "Odigraj eno igro do konca", target: 1 }, daily: { label: "Odigraj dnevni izziv", target: 1 },
  lay3: { label: "Položi 3 kombinacije", target: 3, ev: "lay" }, swap: { label: "Zamenjaj jokerja na mizi", target: 1, ev: "swap" },
  run5: { label: "Položi niz s 5 kartami ali več", target: 1, ev: "run5" }, out2: { label: "Pojdi ven v 2 rundah", target: 2, ev: "out" },
  add3: { label: "Dodaj 3 karte k tujim kombinacijam", target: 3, ev: "add" }, set4: { label: "Položi set štirih enakih", target: 1, ev: "set4" },
};
const TASK_REW = 15, TASK_BONUS = 20;
function tasksFor(day) {
  const h = E.seedOf("naloge-" + day); const easy = ["play1", "daily"][h % 2];
  const rest = Object.keys(TASKS).filter((k) => k !== "play1" && k !== "daily"); const a = rest[(h >>> 3) % rest.length]; const r2 = rest.filter((k) => k !== a);
  return [easy, a, r2[(h >>> 7) % r2.length]];
}
// napredek nalog: ključ dogodka iz igre -> ključ naloge
async function pushTasks(g) {
  for (const p of g.players) { if (p.bot || p.left) continue; const ev = p.ev || {}; const sent = p.evSent || {}; const inc = {};
    for (const k of Object.keys(ev)) { const d = (ev[k] || 0) - (sent[k] || 0); if (d > 0) inc[k] = d; }
    if (Object.keys(inc).length) { await admin.rpc("romi_tasks_inc", { p_user: p.id, p_inc: inc }); p.evSent = { ...ev }; } }
}
const DAILY_REW = [10, 15, 20, 25, 30, 40, 80];
function today(d = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Ljubljana" }).format(d); }
function yesterday() { return today(new Date(Date.now() - 864e5)); }
async function wallet(uid) {
  await admin.from("romi_wallet").upsert({ user_id: uid }, { onConflict: "user_id", ignoreDuplicates: true });
  const { data } = await admin.from("romi_wallet").select("*").eq("user_id", uid).single();
  return data;
}
function ue(m) { const e = new Error(m); e.user = true; return e; }
function displayName(user) {
  const m = user.user_metadata || {};
  return (m.name || m.full_name || (user.email || "").split("@")[0] || "Igralec").toString().slice(0, 24);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? "";
  const headers = { ...cors(origin), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Samo POST." }), { status: 405, headers });
  try {
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: ud, error: uerr } = await admin.auth.getUser(token);
    if (uerr || !ud?.user) return new Response(JSON.stringify({ error: "Prijavi se s foqs. računom." }), { status: 401, headers });
    const user = ud.user; const uid = user.id;
    const body = await req.json().catch(() => ({}));
    const action = body.action; const now = Date.now();

    if (action === "create") {
      const name = String(body.name || "Nova soba").trim().slice(0, 40) || "Nova soba";
      const turn_time = [60, 120, 180].includes(+body.turn_time) ? +body.turn_time : 60;
      // en igralec je lahko samo v eni odprti sobi
      await admin.from("romi_players").delete().eq("user_id", uid);
      const { data: r, error } = await admin.from("romi_rooms").insert({ name, admin: uid, turn_time }).select().single();
      if (error) throw error;
      const me = { room_id: r.id, user_id: uid, name: displayName(user), seat: 0, is_bot: false };
      await admin.from("romi_players").insert(me);
      return ok({ room: r, players: [me] });
    }
    /* ---------- cekini, trgovina, dnevni izziv ---------- */
    if (action === "wallet") {
      const w = await wallet(uid); const d = today();
      const s = w.last_daily === yesterday() ? w.streak + 1 : Math.max(w.streak - 1, 0) + 1; const ns = s > 7 ? 1 : s;
      const [{ data: dr }, { data: tr }] = await Promise.all([admin.from("romi_daily_results").select("*").eq("day", d).eq("user_id", uid).maybeSingle(), admin.from("romi_tasks").select("*").eq("day", d).eq("user_id", uid).maybeSingle()]);
      const prog = tr?.progress || {}; const claimed = tr?.claimed || [];
      const tasks = tasksFor(d).map((k) => { const t = TASKS[k]; const key = t.ev || k; return { key: k, label: t.label, target: t.target, progress: Math.min(t.target, prog[key] || 0), claimed: claimed.includes(key), reward: TASK_REW }; });
      return ok({ wallet: w, today: d, dailyAvail: w.last_daily !== d, nextDaily: { streak: ns, amount: DAILY_REW[ns - 1] }, dailyResult: dr || null, tasks, tasksBonus: { amount: TASK_BONUS, claimed: claimed.includes("all") } });
    }
    if (action === "claim_task") {
      const d = today(); const keys = tasksFor(d); const k = String(body.key || ""); if (!keys.includes(k)) throw ue("Ta naloga danes ni na seznamu.");
      const t = TASKS[k]; const evKey = t.ev || k;
      // napredek se šteje po ključu dogodka; za potrditev prenesemo vrednost na ključ naloge
      const { data: tr } = await admin.from("romi_tasks").select("progress").eq("day", d).eq("user_id", uid).maybeSingle();
      if (((tr?.progress || {})[evKey] || 0) < t.target) throw ue("Naloga še ni opravljena.");
      const { data, error } = await admin.rpc("romi_task_claim", { p_user: uid, p_key: evKey, p_target: t.target, p_reward: TASK_REW, p_keys: keys.map((x) => TASKS[x].ev || x), p_bonus: TASK_BONUS }); if (error) throw error;
      if (!data.ok) throw ue(data.error);
      return ok({ claim: data, wallet: await wallet(uid) });
    }
    if (action === "claim_daily") {
      const { data, error } = await admin.rpc("romi_claim_daily", { p_user: uid }); if (error) throw error;
      return ok({ claim: data, wallet: await wallet(uid) });
    }
    if (action === "buy") {
      const item = String(body.item || ""); if (!(item in SHOP) || !SHOP[item]) throw ue("Tega v trgovini ni.");
      const { data, error } = await admin.rpc("romi_buy", { p_user: uid, p_item: item, p_price: SHOP[item] }); if (error) throw error;
      if (!data.ok) throw ue(data.error);
      return ok({ wallet: await wallet(uid) });
    }
    if (action === "equip") {
      const item = String(body.item || ""); const w = await wallet(uid);
      if (!w.owned.includes(item)) throw ue("Tega še nimaš.");
      const [kind, name] = item.split("_"); if (!["back", "face"].includes(kind)) throw ue("Napačen predmet.");
      await admin.from("romi_wallet").update({ [kind]: name, updated_at: new Date().toISOString() }).eq("user_id", uid);
      return ok({ wallet: await wallet(uid) });
    }
    if (action === "daily_start") {
      const d = today();
      const { data: had } = await admin.from("romi_daily_results").select("day").eq("day", d).eq("user_id", uid).maybeSingle();
      if (had) throw ue("Današnji izziv si že odigral. Nov bo jutri.");
      const { data: mine } = await admin.from("romi_players").select("room_id, romi_rooms!inner(status)").eq("user_id", uid);
      if ((mine || []).some((x) => x.romi_rooms?.status === "playing")) throw ue("Najprej dokončaj igro, ki jo igraš.");
      await admin.from("romi_players").delete().eq("user_id", uid);
      const { data: rr, error } = await admin.from("romi_rooms").insert({ name: "Dnevni izziv", admin: uid, turn_time: 120, private: true }).select().single();
      if (error) throw error;
      const ps = [{ room_id: rr.id, user_id: uid, name: displayName(user), seat: 0, is_bot: false }, { room_id: rr.id, user_id: crypto.randomUUID(), name: "Bot Ana", seat: 1, is_bot: true }, { room_id: rr.id, user_id: crypto.randomUUID(), name: "Bot Bor", seat: 2, is_bot: true }];
      await admin.from("romi_players").insert(ps);
      const g = E.newGame(ps, 120, 9999); g.seed = E.seedOf("romi-" + d); g.maxRounds = 1; g.daily = d; g.starter = 0;
      E.startRound(g, now);
      await saveGame(rr.id, g);
      await Promise.all([bump(rr.id, { status: "playing" }), admin.from("romi_daily_results").insert({ day: d, user_id: uid, name: displayName(user), room_id: rr.id })]);
      return ok({ room: { ...rr, status: "playing" }, view: E.view(g, 0, now) });
    }

    if (action === "campaign_info") {
      const [{ data: mine }, { data: top }] = await Promise.all([admin.from("romi_campaign").select("*").eq("user_id", uid).maybeSingle(), admin.from("romi_campaign").select("name,total,user_id").order("total", { ascending: false }).limit(10)]);
      return ok({ stars: mine?.stars || {}, total: mine?.total || 0, top: top || [] });
    }
    if (action === "campaign_start") {
      const lv = E.CAMPAIGN.levels.find((x) => x.n === +body.level); if (!lv) throw ue("Ni takega nivoja.");
      const { data: mine } = await admin.from("romi_campaign").select("stars").eq("user_id", uid).maybeSingle();
      if (lv.n > 1 && !((mine?.stars || {})[lv.n - 1] > 0)) throw ue("Najprej premagaj prejšnji nivo.");
      const { data: busy } = await admin.from("romi_players").select("room_id, romi_rooms!inner(status)").eq("user_id", uid);
      if ((busy || []).some((x) => x.romi_rooms?.status === "playing")) throw ue("Najprej dokončaj igro, ki jo igraš.");
      await admin.from("romi_players").delete().eq("user_id", uid);
      const tt = body.noTimer ? 3600 : 90;
      const { data: rr, error } = await admin.from("romi_rooms").insert({ name: "Kampanja · " + lv.n + ". " + lv.title, admin: uid, turn_time: tt, goal: lv.goal, private: true }).select().single();
      if (error) throw error;
      const ps = [{ room_id: rr.id, user_id: uid, name: displayName(user), seat: 0, is_bot: false }, ...lv.bots.map(([nm], i) => ({ room_id: rr.id, user_id: crypto.randomUUID(), name: nm, seat: i + 1, is_bot: true }))];
      await admin.from("romi_players").insert(ps);
      const g = E.newGame(ps.map((p, i) => ({ ...p, lvl: i ? lv.bots[i - 1][1] : undefined })), tt, lv.goal); g.campaign = lv.n; g.noTimer = !!body.noTimer; g.starter = 0;
      E.startRound(g, now);
      await saveGame(rr.id, g); await bump(rr.id, { status: "playing" });
      return ok({ room: { ...rr, status: "playing" }, view: E.view(g, 0, now) });
    }

    const roomId = body.room_id; if (!roomId) throw ue("Manjka soba.");
    const r = await room(roomId);

    if (action === "join") {
      if (r.private) throw ue("To je zasebna soba.");
      if (r.status !== "waiting") throw ue("Igra v tej sobi že teče.");
      const ps = await players(roomId);
      if (ps.some((p) => p.user_id === uid)) return ok({ room: r });
      if (ps.length >= 4) throw ue("Soba je polna.");
      await admin.from("romi_players").delete().eq("user_id", uid);
      const seat = [0, 1, 2, 3].find((s) => !ps.some((p) => p.seat === s));
      const me = { room_id: roomId, user_id: uid, name: displayName(user), seat, is_bot: false };
      await Promise.all([admin.from("romi_players").insert(me), bump(roomId)]);
      return ok({ room: r, players: [...ps, me] });
    }
    if (action === "leave") {
      if (r.status === "waiting") {
        await admin.from("romi_players").delete().eq("room_id", roomId).eq("user_id", uid);
        const ps = await players(roomId);
        if (!ps.length || r.admin === uid) await admin.from("romi_rooms").delete().eq("id", roomId); else await bump(roomId);
      }
      return ok({});
    }
    if (action === "kick") {
      if (r.admin !== uid) throw ue("Samo admin.");
      if (r.status !== "waiting") throw ue("Med igro ne gre.");
      await Promise.all([admin.from("romi_players").delete().eq("room_id", roomId).eq("user_id", body.user_id), bump(roomId)]);
      return ok({ room: r, players: await players(roomId) });
    }
    if (action === "add_bot") {
      if (r.admin !== uid) throw ue("Samo admin.");
      if (r.status !== "waiting") throw ue("Med igro ne gre.");
      const ps = await players(roomId); if (ps.length >= 4) throw ue("Soba je polna.");
      const names = ["Bot Ana", "Bot Bor", "Bot Cene", "Bot Dana"]; const name = names.find((n) => !ps.some((p) => p.name === n)) || "Bot";
      const seat = [0, 1, 2, 3].find((s) => !ps.some((p) => p.seat === s));
      const bot = { room_id: roomId, user_id: crypto.randomUUID(), name, seat, is_bot: true };
      await Promise.all([admin.from("romi_players").insert(bot), bump(roomId)]);
      return ok({ room: r, players: [...ps, bot] });
    }
    if (action === "start") {
      if (r.admin !== uid) throw ue("Samo admin lahko začne igro.");
      if (r.status !== "waiting") throw ue("Igra že teče.");
      const ps = await players(roomId);
      if (ps.length < 2) throw ue("Za igro rabiš vsaj 2 igralca.");
      const g = E.newGame(ps.map((p, i) => ({ ...p, seat: i })), r.turn_time, r.goal);
      g.starter = Math.floor(Math.random() * ps.length);
      E.startRound(g, now);
      await Promise.all([...ps.map((p, i) => admin.from("romi_players").update({ seat: i }).eq("room_id", roomId).eq("user_id", p.user_id)), saveGame(roomId, g)]);
      await bump(roomId, { status: "playing" });
      return ok({ view: E.view(g, ps.findIndex((p) => p.user_id === uid), now) });
    }
    if (action === "end") {
      if (r.admin !== uid) throw ue("Samo admin.");
      const g = await loadGame(roomId);
      if (g) { g.status = "finished"; g.log.push({ t: now, m: "Admin je končal igro." }); await saveGame(roomId, g); }
      await bump(roomId, { status: "finished" }); return ok({});
    }

    // akcije v igri
    const g = await loadGame(roomId); if (!g) throw ue("Igra še ni začeta.");
    const seat = g.players.findIndex((p) => p.id === uid && !p.left); if (seat < 0) throw ue("Nisi več v tej igri.");
    let changed = false;
    if (action === "quit") {
      E.quit(g, seat, now);
      // prosto mesto za druge sobe; admin preide na naslednjega človeka
      await admin.from("romi_players").delete().eq("room_id", roomId).eq("user_id", uid);
      if (r.admin === uid) { const next = g.players.find((p) => !p.bot && !p.left); if (next) await admin.from("romi_rooms").update({ admin: next.id }).eq("id", roomId); }
      await Promise.all([saveGame(roomId, g), bump(roomId, g.status === "finished" ? { status: "finished" } : {})]);
      return ok({ quit: true });
    }
    if (action === "hint") {
      if (!g.campaign && !g.daily) throw ue("Namig je na voljo samo v kampanji in dnevnem izzivu.");
      if (g.turn !== seat || g.phase !== "play") throw ue("Namig dobiš, ko si na potezi in si že vlekel.");
      const h = E.findHint(g, seat); if (!h) return ok({ hint: null, view: E.view(g, seat, now) });
      const { data: paid } = await admin.rpc("romi_spend", { p_user: uid, p_amount: 20, p_reason: "hint" });
      if (!paid) throw ue("Za namig rabiš 20 cekinov.");
      return ok({ hint: h, view: E.view(g, seat, now) });
    }
    if (action === "pause" || action === "resume") {
      if (r.admin !== uid) throw ue("Samo admin lahko ustavi igro.");
      if (action === "pause" && !g.paused) { g.paused = true; g.pausedAt = now; g.log.push({ t: now, m: "Admin je ustavil igro (pavza)." }); changed = true; }
      if (action === "resume" && g.paused) { g.turnStarted += now - g.pausedAt; g.paused = false; g.log.push({ t: now, m: "Igra se nadaljuje." }); changed = true; }
    } else if (action === "view" || action === "tick") {
      changed = E.checkTimeout(g, now) || E.botStep(g, now);
    } else {
      changed = E.checkTimeout(g, now);
      if (!changed) { E.act(g, seat, { type: action, ...body }, now); changed = true; }
      else if (action !== "ready") throw ue("Čas je potekel, poteza je bila odigrana samodejno.");
    }
    if (changed) {
      // globalna lestvica: samo naravno zaključene igre, enkrat
      await pushTasks(g);
      if (g.status === "finished" && !g.tasksDone && !g.abandoned && (g.finishedNaturally || g.daily)) {
        g.tasksDone = true;
        await Promise.all(g.players.filter((p) => !p.bot && !p.left).map((p) => admin.rpc("romi_tasks_inc", { p_user: p.id, p_inc: g.daily ? { play1: 1, daily: 1 } : { play1: 1 } })));
      }
      // kampanja: zvezdice in cekini (ne šteje v globalno lestvico)
      if (g.campaign && g.status === "finished" && !g.coinsDone && !g.abandoned) {
        g.coinsDone = true; g.statsDone = true; g.awards = {};
        const res = E.campaignResult(g);
        if (res) {
          const p = g.players[res.seat]; const lv = E.CAMPAIGN.levels.find((x) => x.n === g.campaign);
          const { data: prev } = await admin.rpc("romi_campaign_result", { p_user: p.id, p_name: p.name, p_level: g.campaign, p_stars: res.stars });
          const parts = [];
          if (res.won && !prev) parts.push({ label: "Prvič premagan nivo " + lv.n, n: lv.coins });
          if (res.stars > (prev || 0)) parts.push({ label: "Nove zvezdice ×" + (res.stars - (prev || 0)), n: 10 * (res.stars - (prev || 0)) });
          if (res.won && prev) parts.push({ label: "Ponovna zmaga", n: 5 });
          const total = parts.reduce((a, x) => a + x.n, 0);
          const { data: got } = total ? await admin.rpc("romi_award", { p_user: p.id, p_amount: total, p_reason: "campaign", p_meta: { level: lv.n, stars: res.stars }, p_bot: false }) : { data: 0 };
          let unlock = null; if (res.won && !prev && lv.unlock) { await admin.rpc("romi_grant_item", { p_user: p.id, p_item: lv.unlock }); unlock = lv.unlock; }
          g.awards[res.seat] = { total, parts, credited: got ?? 0, place: res.won ? 0 : 1, campaign: { ...res, prev: prev || 0, unlock } };
        }
      }
      if (g.status === "finished" && g.finishedNaturally && !g.statsDone) {
        g.statsDone = true;
        await Promise.all(g.players.filter((p) => !p.bot).map((p) => admin.rpc("romi_add_stat", { p_user: p.id, p_name: p.name, p_points: p.score, p_win: p.seat === g.winner })));
      }
      // cekini: enkrat ob koncu igre (naravno končane ali dnevni izziv)
      if (g.status === "finished" && !g.coinsDone && !g.abandoned && (g.finishedNaturally || g.daily)) {
        g.coinsDone = true; g.awards = {};
        const aw = E.computeAwards(g) || {};
        for (const [st, a] of Object.entries(aw)) {
          const p = g.players[+st];
          const { data: got } = await admin.rpc("romi_award", { p_user: p.id, p_amount: a.total, p_reason: g.daily ? "daily_game" : "game", p_meta: { room: roomId, parts: a.parts }, p_bot: !!a.solo });
          g.awards[st] = { ...a, credited: got ?? 0, limited: !!a.solo && !got && a.total > 0 };
          if (g.daily) await admin.from("romi_daily_results").update({ score: g.rounds[0]?.[+st] ?? p.score, won: a.place === 0 }).eq("day", g.daily).eq("user_id", p.id);
        }
      }
      await Promise.all([saveGame(roomId, g), bump(roomId, g.status === "finished" ? { status: "finished" } : {})]);
    }
    return ok({ view: E.view(g, seat, now) });
  } catch (e) {
    const msg = e?.user ? e.message : "Napaka na strežniku: " + (e?.message || e);
    if (!e?.user) console.error(e);
    return new Response(JSON.stringify({ error: msg }), { status: e?.user ? 400 : 500, headers });
  }
  function ok(o) { return new Response(JSON.stringify(o), { headers }); }
});
