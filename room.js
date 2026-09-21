import { blankGame, applyOp, opOk, withinLimits } from "./ops.js";

/* One Durable Object per game code: the single authoritative copy of
   that game, plus the sockets currently watching it.

   Sockets are accepted with hibernation, so a room with people
   connected but idle costs no compute. That matters on the free plan,
   where the budget is duration (GB-s) as much as requests — a pub golf
   night is hours of connected-but-idle time. */
export class Room {
  constructor(ctx, env){
    this.ctx = ctx;
    this.env = env;
    this.game = null;
  }

  async load(){
    if(!this.game){
      this.game = (await this.ctx.storage.get("game")) || blankGame();
    }
    return this.game;
  }

  async save(){
    await this.ctx.storage.put("game", this.game);
  }

  async fetch(req){
    const url = new URL(req.url);
    const route = url.searchParams.get("route");

    if(route === "ws"){
      if(req.headers.get("Upgrade") !== "websocket"){
        return new Response("expected websocket", {status:426});
      }
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      const game = await this.load();
      try{
        pair[1].send(JSON.stringify({t:"state", game}));
      }catch(e){ /* the client may already be gone */ }
      return new Response(null, {status:101, webSocket:pair[0]});
    }

    if(route === "state"){
      const game = await this.load();
      return json({t:"state", game});
    }

    if(route === "op" && req.method === "POST"){
      let body;
      try{ body = await req.json(); }catch(e){ return json({error:"bad json"}, 400); }
      const res = await this.commit(body && body.op);
      return res.error ? json(res, 400) : json(res);
    }

    if(route === "reset" && req.method === "POST"){
      this.game = blankGame();
      await this.save();
      this.broadcast({t:"state", game:this.game});
      return json({ok:true, v:this.game.v});
    }

    return new Response("not found", {status:404});
  }

  /* Apply an op, bump the version, persist, tell everyone. */
  async commit(op, from){
    if(!opOk(op)) return {error:"rejected op"};
    const game = await this.load();
    const before = game.v;
    if(!applyOp(game, op)) return {ok:true, v:before, noop:true};
    const bad = withinLimits(game);
    if(bad){
      /* roll back by reloading the stored copy */
      this.game = null;
      await this.load();
      return {error:bad};
    }
    game.v = before + 1;
    await this.save();
    this.broadcast({t:"op", op, v:game.v}, from);
    return {ok:true, v:game.v};
  }

  broadcast(msg, except){
    const s = JSON.stringify(msg);
    for(const ws of this.ctx.getWebSockets()){
      if(ws === except) continue;
      try{ ws.send(s); }catch(e){ /* dropped */ }
    }
  }

  async webSocketMessage(ws, raw){
    if(typeof raw !== "string" || raw.length > 40000) return;
    let msg;
    try{ msg = JSON.parse(raw); }catch(e){ return; }

    if(msg.t === "ping"){
      try{ ws.send(JSON.stringify({t:"pong"})); }catch(e){}
      return;
    }
    if(msg.t === "sync"){
      const game = await this.load();
      try{ ws.send(JSON.stringify({t:"state", game})); }catch(e){}
      return;
    }
    if(msg.t === "op"){
      const res = await this.commit(msg.op, ws);
      try{ ws.send(JSON.stringify({t:"ack", id:msg.id, ...res})); }catch(e){}
      /* If we rejected it, the sender's local copy is now wrong — give
         it the truth rather than leaving it to drift. */
      if(res.error){
        const game = await this.load();
        try{ ws.send(JSON.stringify({t:"state", game})); }catch(e){}
      }
    }
  }

  async webSocketClose(ws, code, reason, wasClean){
    try{ ws.close(1000, "bye"); }catch(e){}
  }

  async webSocketError(){ /* nothing to do; the socket is gone */ }
}

function json(obj, status){
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {"content-type":"application/json; charset=utf-8", "cache-control":"no-store"}
  });
}
