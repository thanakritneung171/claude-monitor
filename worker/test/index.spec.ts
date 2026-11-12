// Smoke tests ที่ CI รันก่อน deploy — เช็คว่า route สาธารณะ / ประตู auth / การรับ log
// ยังทำงานตามที่ควร (รันบน workerd + D1 local ว่าง ๆ ไม่แตะ production)
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

const BASE = "https://worker.test";

beforeAll(async () => {
	// สร้างเฉพาะตารางที่ route ในไฟล์นี้ใช้ (ดู migrations/0002_auth.sql, 0003_logto.sql)
	await env.DB.batch([
		env.DB.prepare(
			"CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
		),
		env.DB.prepare(
			"CREATE TABLE IF NOT EXISTS oauth_state (state TEXT PRIMARY KEY, code_verifier TEXT NOT NULL, next_path TEXT NOT NULL, expires_at INTEGER NOT NULL)",
		),
	]);
});

describe("public routes", () => {
	it("GET /health returns ok", async () => {
		const res = await SELF.fetch(`${BASE}/health`);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});

	it("OPTIONS answers CORS preflight", async () => {
		const res = await SELF.fetch(`${BASE}/log`, { method: "OPTIONS" });
		expect(res.status).toBe(200);
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
	});

	it("GET /login redirects to Logto with PKCE", async () => {
		const res = await SELF.fetch(`${BASE}/login`, { redirect: "manual" });
		expect(res.status).toBe(302);
		const loc = new URL(res.headers.get("Location") ?? "");
		expect(`${loc.origin}${loc.pathname}`).toBe(
			`${env.LOGTO_ENDPOINT.replace(/\/+$/, "")}/oidc/auth`,
		);
		expect(loc.searchParams.get("client_id")).toBe(env.LOGTO_APP_ID);
		expect(loc.searchParams.get("code_challenge_method")).toBe("S256");
	});
});

describe("ingest /log", () => {
	it("rejects a missing X-Api-Key with 401", async () => {
		const res = await SELF.fetch(`${BASE}/log`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ prompt: "x" }),
		});
		expect(res.status).toBe(401);
	});

	it("rejects a wrong X-Api-Key with 401", async () => {
		await env.DB.prepare(
			"INSERT OR REPLACE INTO app_settings (key, value) VALUES ('ingest_key', 'test-ingest-key')",
		).run();
		const res = await SELF.fetch(`${BASE}/log`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Api-Key": "wrong-key" },
			body: JSON.stringify({ prompt: "x" }),
		});
		expect(res.status).toBe(401);
	});
});

describe("auth gate", () => {
	it("JSON request without session gets 401", async () => {
		const res = await SELF.fetch(`${BASE}/`);
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ ok: false, error: "Unauthorized" });
	});

	it("HTML page without session redirects to /login with next", async () => {
		const res = await SELF.fetch(`${BASE}/logs?client=claude-web`, {
			headers: { Accept: "text/html" },
			redirect: "manual",
		});
		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe(
			`/login?next=${encodeURIComponent("/logs?client=claude-web")}`,
		);
	});
});
