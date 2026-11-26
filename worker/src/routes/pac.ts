// GET /proxy.pac — PAC (proxy auto-config) ที่ install-claude-proxy.bat ตั้งเป็น
// AutoConfigURL ของ Windows แทน system proxy แบบจับทุก host
//
// ส่งเข้า mitmproxy เฉพาะโดเมน Claude/Anthropic (ชุดเดียวกับ --allow-hosts บน server)
// ที่เหลือออก DIRECT — เว็บอื่นใช้ได้ทั้งตอนต่อและไม่ต่อ VPN และไม่ต้องอ้อมผ่าน VPN จนช้า
//
// ต้องเป็น public (ไม่ผ่าน requireUser) เพราะ Chromium / WinINET ดึง PAC แบบไม่มี cookie
// และต้องอยู่ที่ที่ไปถึงได้เสมอ: ถ้าวาง PAC ไว้บน 10.10.84.1 ตอนไม่ต่อ VPN Chromium
// จะค้างทุก request ~21-30 วินาทีรอดึง PAC ทุกครั้งที่เปิดแอป/เปลี่ยนเครือข่าย

/** mitmproxy กลาง (อยู่หลัง VPN) */
export const PAC_PROXY = '10.10.84.1:8081';

/** โดเมนที่ต้องผ่าน proxy — ตรงกับ --allow-hosts "(anthropic\.com|claude\.ai|claudeusercontent\.com)" */
export const PAC_DOMAINS = ['anthropic.com', 'claude.ai', 'claudeusercontent.com'] as const;

/**
 * false = fail-closed: ไม่ต่อ VPN แล้วแอป Claude ต่อไม่ได้ (~8 วิ ERR_TIMED_OUT) แต่ไม่มี
 *         prompt หลุดโดยไม่ถูก log — ตรงกับ Claude Code ที่ใช้ HTTPS_PROXY ใน settings.json
 * true  = fail-open: ไม่ต่อ VPN แล้ว request แรกรอ ~8 วิ จากนั้นออกตรง (ไม่ถูก log) 5 นาที
 */
export const PAC_FAIL_OPEN = false;

export function buildPac(): string {
	const target = PAC_FAIL_OPEN ? `PROXY ${PAC_PROXY}; DIRECT` : `PROXY ${PAC_PROXY}`;
	const conds = PAC_DOMAINS.map((d) => `host == "${d}" || dnsDomainIs(host, ".${d}")`).join(' ||\n      ');
	// ASCII only: WinHTTP/WinINET don't always honour the charset of a PAC response
	return `// SDB AI Insight - Claude-only PAC (claude-monitor-hooks /proxy.pac)
// Claude/Anthropic -> mitmproxy (logged, needs VPN); everything else -> DIRECT.
function FindProxyForURL(url, host) {
  host = host.toLowerCase();
  if (host.charAt(host.length - 1) == ".") host = host.substring(0, host.length - 1);
  if (${conds})
    return "${target}";
  return "DIRECT";
}
`;
}

export function handlePac(): Response {
	// HEAD: runtime ตัด body ให้เอง
	return new Response(buildPac(), {
		headers: {
			// WinHTTP ใช้ PAC เฉพาะเมื่อ Content-Type นี้ หรือ URL ลงท้าย .pac
			'Content-Type': 'application/x-ns-proxy-autoconfig; charset=utf-8',
			'Cache-Control': 'no-cache',
		},
	});
}
