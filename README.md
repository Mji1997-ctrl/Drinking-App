# Pub Golf — live scoring server

A single Cloudflare Worker that serves the pub golf app and keeps everyone's
scores in step in real time. Nothing to maintain, no machine to leave running,
and on Cloudflare's free plan a pub golf night costs nothing.

Everyone opens one link. Anyone can score anyone. Edits show up on the other
phones as they're typed, and a phone that loses signal keeps working and catches
up when it's back.

---

## Deploy it

You need Node installed and a free Cloudflare account. Three commands:

```bash
npm install
npx wrangler login      # opens a browser, one time only
npx wrangler deploy
```

That prints your URL — something like `https://pubgolf.<your-subdomain>.workers.dev`.
Open it, hit **Share → Start a live game**, and send the group the link it gives you.

To put it on your own domain instead, add this to `wrangler.toml` and redeploy:

```toml
routes = [{ pattern = "pubgolf.example.com", custom_domain = true }]
```

### Running it locally first

```bash
npm run dev     # http://127.0.0.1:8787
```

Durable Objects work locally, so you can open the URL in two browser windows
and watch scores sync before you deploy anything.

---

## What it costs

Cloudflare's Workers Free plan includes 100,000 requests/day and, for Durable
Objects, 13,000 GB-s/day of duration plus 100,000 SQLite row writes/day
(figures from Cloudflare's own limits and Durable Objects pricing pages,
checked September 2026 — worth a glance in case they've moved).

A nine-hole night with six players is on the order of a few hundred edits and a
handful of WebSocket connections. The sockets are accepted with **hibernation**,
so a game that's connected but idle — which is most of an evening — isn't
burning duration while nobody's typing. You will not get near the free tier.

The one thing to know: Durable Objects on the free plan must use the SQLite
storage backend. That's what `new_sqlite_classes` in `wrangler.toml` sets, so
don't change it to `new_classes` or the deploy will want a paid plan.

---

## How the sync works

An edit is never "here is the whole game". It's **"set this path to this
value"**:

```js
{ t: "set", p: ["players", "a3f", "holes", "4", "s"], v: 3 }
```

Two people scoring different holes touch different paths, so they can't
overwrite each other. If two people do type the same score, the later one
wins — which is the right answer for a pub crawl.

- `src/ops.js` — the whole protocol: which paths are allowed, what a valid
  value is, and `applyOp`. The client runs the same logic, so there's one
  definition of what an edit means. **If you change the rules here, change
  `applyLocal` in `public/app.html` to match.**
- `src/room.js` — one Durable Object per game code: the authoritative copy,
  plus the sockets watching it. It applies each op, bumps a version, saves,
  and relays.
- `src/index.js` — routing, and serving the app.
- `public/app.html` — the whole app, including the baked-in street map. Imported
  into the Worker as a string via the `[[rules]]` block, so there's no separate
  static hosting to configure.

Offline behaviour: edits made with no connection are applied locally, queued in
the page, and replayed on reconnect. The server's copy wins when they differ, so
a phone that was out of signal for three holes catches up rather than fighting.
The header badge tells you which state you're in — *Live*, *n to send*, or
*This phone*.

### Routes

| Route | What it does |
|---|---|
| `GET /` | the app |
| `GET /g/<CODE>` | the app, joining that game |
| `GET /api/<CODE>/ws` | WebSocket — live sync |
| `GET /api/<CODE>/state` | the current game as JSON |
| `POST /api/<CODE>/op` | apply one op (fallback if WebSockets are blocked) |
| `POST /api/<CODE>/reset` | wipe that game |

---

## Security, honestly

**Anyone with the game code can read and change that game.** There are no
accounts and no passwords — that's a deliberate trade for handing a link to
five friends outside your organisation, and it's the right call for a scorecard
of who spilled a pint. It is not the right call for anything you'd mind a
stranger editing.

What is in place:
- Codes are six characters from a 30-character alphabet with no `O/0/I/1/L`,
  so they're hard to mistype and ~1 in 700 million to guess.
- Only `setup` and `players` paths are writable; `__proto__`, `constructor`
  and `prototype` are rejected outright, as is any unknown root.
- Games are capped (32 players, 30 holes, 120 KB) so a bad client can't grow
  one without bound.
- The app is served with a CSP that allows only its own origin plus Google
  Fonts.

If you ever want it locked down, the cheapest honest option is a shared
passphrase checked in the Worker before it hands over the Durable Object.

---

## Why not run it on your phone

You asked, so: on Android it's genuinely possible — Termux plus Node, served
over your hotspot at something like `192.168.43.1:8787`, no internet needed.
On iOS it isn't; the OS won't keep a background listener alive.

Three reasons I'd still not do it for this:

1. **Carrier NAT.** Mobile networks put your phone behind shared IPv4, so
   nobody can reach it from the internet. Everyone would have to join *your
   hotspot* and stay on it — which kills their own data and drops every time
   you walk between pubs.
2. **Battery.** A server, a hotspot and nine holes of photos on one phone is a
   dead phone by the back nine, and it's the phone holding the scorecard.
3. **It's the referee.** If the server is in someone's pocket and that pocket
   goes flat or leaves early, the round goes with it.

The Worker costs nothing, has no battery, and is still entirely yours.
