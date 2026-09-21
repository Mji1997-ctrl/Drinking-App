import APP_HTML from "./app.html";

export { Room } from "./room.js";

/* Game codes: an alphabet with no 0/O/1/I/L so nobody mistypes one
   after hole six. Six characters is ~1.1 billion combinations, which
   is enough that a stranger will not stumble into your game. */
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4,8}$/;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    if(path === "/" || path === "/index.html") return page();

    const g = path.match(/^\/g\/([^/]+)\/?$/);
    if(g) return page();                       // the app reads the code from the URL itself

    const api = path.match(/^\/api\/([^/]+)\/(ws|state|op|reset)$/);
    if(api){
      const code = decodeURIComponent(api[1]).toUpperCase();
      if(!CODE_RE.test(code)){
        return json({error:"bad game code"}, 400);
      }
      const id = env.ROOM.idFromName(code);
      const room = env.ROOM.get(id);
      const fwd = new URL(req.url);
      fwd.searchParams.set("route", api[2]);
      return room.fetch(new Request(fwd, req));
    }

    if(path === "/healthz") return json({ok:true});
    if(path === "/favicon.ico") return new Response(null, {status:204});

    return new Response("Not found", {status:404});
  }
};

function page(){
  return new Response(APP_HTML, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      /* The app is self-contained apart from Google Fonts. */
      "content-security-policy":
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline'; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src https://fonts.gstatic.com; " +
        "img-src 'self' data:; " +
        "connect-src 'self' ws: wss:; " +
        "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "cache-control": "no-cache"
    }
  });
}

function json(obj, status){
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {"content-type":"application/json; charset=utf-8", "cache-control":"no-store"}
  });
}
