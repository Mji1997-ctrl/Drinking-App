/* ------------------------------------------------------------------
   The whole sync protocol, in one small file.

   An edit is never "here is the new game" — it is "set this one path
   to this value". Two people scoring different holes touch different
   paths, so they cannot clobber each other, and the last write to any
   single field wins. That is the right behaviour for a pub crawl: if
   two people both type your score for hole 4, the later one stands.

   The client and the server run this same file, so there is one
   definition of what an edit means.
   ------------------------------------------------------------------ */

export const LIMITS = {
  players: 32, holes: 30, pens: 20, pathDepth: 6,
  nameLen: 40, strokes: 99, penCount: 20, stateBytes: 120000
};

export function blankGame(){
  return {v: 0, setup: null, players: {}};
}

/* Paths we accept. Anything else is rejected outright, so a bad or
   hostile client cannot write arbitrary keys into the stored game. */
function pathOk(p){
  if(!Array.isArray(p) || !p.length || p.length > LIMITS.pathDepth) return false;
  for(const seg of p){
    if(typeof seg !== "string" || !seg.length || seg.length > 48) return false;
    if(seg === "__proto__" || seg === "constructor" || seg === "prototype") return false;
  }
  /* Both roots may be replaced wholesale — that is how a new game gets
     seeded and how a pasted round code is pushed up. withinLimits()
     below is what stops either from being used to bloat the game. */
  if(p[0] === "setup" || p[0] === "players") return true;
  return false;
}

function valueOk(v){
  if(v === null) return true;
  const t = typeof v;
  if(t === "number") return Number.isFinite(v);
  if(t === "string") return v.length <= 400;
  if(t === "boolean") return true;
  if(t === "object"){
    try{ return JSON.stringify(v).length <= 100000; }catch(e){ return false; }
  }
  return false;
}

export function opOk(op){
  if(!op || typeof op !== "object") return false;
  if(op.t === "set") return pathOk(op.p) && valueOk(op.v);
  if(op.t === "del") return pathOk(op.p);
  if(op.t === "batch") return Array.isArray(op.ops) && op.ops.length <= 60 && op.ops.every(opOk);
  return false;
}

/* Apply one op in place. Returns true if anything changed. */
export function applyOp(game, op){
  if(op.t === "batch"){
    let any = false;
    for(const o of op.ops) if(applyOp(game, o)) any = true;
    return any;
  }
  const p = op.p;
  let node = game;
  for(let i = 0; i < p.length - 1; i++){
    const k = p[i];
    if(node[k] == null || typeof node[k] !== "object") {
      if(op.t === "del") return false;          // nothing to delete
      node[k] = {};
    }
    node = node[k];
  }
  const last = p[p.length - 1];
  if(op.t === "del"){
    if(!(last in node)) return false;
    delete node[last];
    return true;
  }
  if(JSON.stringify(node[last]) === JSON.stringify(op.v)) return false;
  node[last] = op.v;
  return true;
}

/* Server-side sanity pass after applying ops: keeps a game from being
   grown without bound by a buggy or malicious client. */
export function withinLimits(game){
  if(Object.keys(game.players || {}).length > LIMITS.players) return "too many players";
  const h = game.setup && game.setup.holes;
  if(h && (!Array.isArray(h) ? Object.keys(h).length : h.length) > LIMITS.holes) return "too many holes";
  let size = 0;
  try{ size = JSON.stringify(game).length; }catch(e){ return "unserialisable"; }
  if(size > LIMITS.stateBytes) return "game too large";
  return null;
}
