// 사이트 '내 정보'용 읽기 전용 API: 금액과 연속 출석만 돌려준다.
// SITE_API_TOKEN을 설정했을 때만 켜지고, 기본은 127.0.0.1에서만 받는다 (외부 공개는 터널/프록시로).
const http = require("node:http");
const crypto = require("node:crypto");
const db = require("../../Database");

const PORT = Number(process.env.SITE_API_PORT || 3901);
const TOKEN = process.env.SITE_API_TOKEN || "";

const same = (a, b) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function startSiteApi(client) {
  if (!TOKEN) return console.log("🌐 사이트 API 꺼짐 (SITE_API_TOKEN 없음)");
  const registered = db.prepare("SELECT guild_id FROM admin_contact WHERE user_id = ? ORDER BY guild_id");
  const { registeredGuilds } = require("./siteAdmin");
  const find = db.prepare("SELECT money, streak FROM user WHERE user_id = ?");
  http
    .createServer(async (req, res) => {
      const json = (code, body) =>
        res
          .writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" })
          .end(JSON.stringify(body));
      const auth = (req.headers.authorization || "").replace(/^Bearer /, "");
      if (req.method !== "GET" || !same(auth, TOKEN))
        return json(401, { error: "unauthorized" });
      const admin = req.url.match(/^\/admin\/(\d{15,25})$/);
      if (admin) {
        try {
          const rows = registered.all(admin[1]);
          if (!rows.length) return json(403, { error: "forbidden" });
          const guilds = await registeredGuilds(client, rows, admin[1]);
          return guilds.length ? json(200, { guilds }) : json(403, { error: "forbidden" });
        } catch { return json(503, { error: "unavailable" }); }
      }
      const m = req.url.match(/^\/user\/(\d{15,25})$/);
      if (!m) return json(404, { error: "not_found" });
      const row = find.get(m[1]);
      if (!row) return json(404, { error: "no_user" });
      json(200, { money: row.money, streak: row.streak });
    })
    .listen(PORT, process.env.SITE_API_HOST || "127.0.0.1", () =>
      console.log(
        `🌐 사이트 API: ${process.env.SITE_API_HOST || "127.0.0.1"}:${PORT}`,
      ),
    );
}

module.exports = { startSiteApi };
