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
  const { data } = await admin.from("romi_rooms").select("version").eq("id", roomId).single();
  await admin.from("romi_rooms").update({ ...patch, version: (data?.version ?? 0) + 1, updated_at: new Date().toISOString() }).eq("id", roomId);
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
      await admin.from("romi_players").insert({ room_id: r.id, user_id: uid, name: displayName(user), seat: 0 });
      return ok({ room: r });
    }
    const roomId = body.room_id; if (!roomId) throw ue("Manjka soba.");
    const r = await room(roomId);

    if (action === "join") {
      if (r.status !== "waiting") throw ue("Igra v tej sobi že teče.");
      const ps = await players(roomId);
      if (ps.some((p) => p.user_id === uid)) return ok({ room: r });
      if (ps.length >= 4) throw ue("Soba je polna.");
      await admin.from("romi_players").delete().eq("user_id", uid);
      const seat = [0, 1, 2, 3].find((s) => !ps.some((p) => p.seat === s));
      await admin.from("romi_players").insert({ room_id: roomId, user_id: uid, name: displayName(user), seat });
      await bump(roomId); return ok({ room: r });
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
      await admin.from("romi_players").delete().eq("room_id", roomId).eq("user_id", body.user_id);
      await bump(roomId); return ok({});
    }
    if (action === "add_bot") {
      if (r.admin !== uid) throw ue("Samo admin.");
      if (r.status !== "waiting") throw ue("Med igro ne gre.");
      const ps = await players(roomId); if (ps.length >= 4) throw ue("Soba je polna.");
      const names = ["Bot Ana", "Bot Bor", "Bot Cene", "Bot Dana"]; const name = names.find((n) => !ps.some((p) => p.name === n)) || "Bot";
      const seat = [0, 1, 2, 3].find((s) => !ps.some((p) => p.seat === s));
      await admin.from("romi_players").insert({ room_id: roomId, user_id: crypto.randomUUID(), name, seat, is_bot: true });
      await bump(roomId); return ok({});
    }
    if (action === "start") {
      if (r.admin !== uid) throw ue("Samo admin lahko začne igro.");
      if (r.status !== "waiting") throw ue("Igra že teče.");
      const ps = await players(roomId);
      if (ps.length < 2) throw ue("Za igro rabiš vsaj 2 igralca.");
      const g = E.newGame(ps.map((p, i) => ({ ...p, seat: i })), r.turn_time, r.goal);
      g.starter = Math.floor(Math.random() * ps.length);
      E.startRound(g, now);
      await Promise.all(ps.map((p, i) => admin.from("romi_players").update({ seat: i }).eq("room_id", roomId).eq("user_id", p.user_id)));
      await saveGame(roomId, g); await bump(roomId, { status: "playing" });
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
    const seat = g.players.findIndex((p) => p.id === uid); if (seat < 0) throw ue("Nisi v tej igri.");
    let changed = false;
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
      await saveGame(roomId, g);
      await bump(roomId, g.status === "finished" ? { status: "finished" } : {});
    }
    return ok({ view: E.view(g, seat, now) });
  } catch (e) {
    const msg = e?.user ? e.message : "Napaka na strežniku: " + (e?.message || e);
    if (!e?.user) console.error(e);
    return new Response(JSON.stringify({ error: msg }), { status: e?.user ? 400 : 500, headers });
  }
  function ok(o) { return new Response(JSON.stringify(o), { headers }); }
});
