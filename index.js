#!/usr/bin/env node

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// ─── CONFIG ────────────────────────────────────────────────────────────────
// Usage: node index.js <portal_base> <mac> [serial] [device_id] [device_id2] [signature] [output]
//
// Examples:
//   node index.js http://fastshare1.com 00:1A:79:00:00:AB
//   node index.js http://livebox.pro 00:1A:79:BE:B2:2A
//   node index.js http://server.com/c/ 00:1A:79:XX:XX:XX "" "" "" "" playlist.m3u
// ───────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

const CFG = {
  base:      args[0] || process.env.PORTAL_BASE || 'http://fastshare1.com',
  mac:       args[1] || process.env.MAC         || '00:1A:79:00:00:AB',
  serial:    args[2] || process.env.SERIAL      || '',
  device_id: args[3] || process.env.DEVICE_ID   || '',
  device_id2:args[4] || process.env.DEVICE_ID2  || '',
  signature: args[5] || process.env.SIGNATURE   || '',
  output:    args[6] || process.env.OUTPUT      || 'dalo.m3u',
};

// If empty metadata, generate from MAC (many portals accept this)
if (!CFG.serial) {
  const crypto = require('crypto');
  const macClean = CFG.mac.replace(/:/g, '');
  CFG.serial = crypto.createHash('md5').update(macClean).digest('hex').substring(0, 13).toUpperCase();
}
if (!CFG.device_id) {
  CFG.device_id = CFG.serial.padEnd(64, 'F').substring(0, 64).toUpperCase();
}
if (!CFG.device_id2) {
  CFG.device_id2 = CFG.serial.padEnd(64, 'F').substring(0, 64).toUpperCase();
}
if (!CFG.signature) {
  CFG.signature = CFG.serial.padEnd(64, 'F').substring(0, 64).toUpperCase();
}

// ─── Try multiple endpoint paths ──────────────────────────────────────────
const ENDPOINTS = [
  '/portal.php',
  '/stalker_portal/server/load.php',
  '/stalker/server/load.php',
  '/server/load.php',
  '/c/portal.php',
];

const UA = 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG254 stbapp ver: 4 rev: 2116 Mobile Safari/533.3';
const XUA = 'Model: MAG254; Link: Ethernet';

// ─── Colored logging ─────────────────────────────────────────────────────
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

function log(msg, ok = true) {
  const icon = ok ? `${colors.green}✓${colors.reset}` : `${colors.red}✗${colors.reset}`;
  console.log(`  ${icon} ${msg}`);
}

function logInfo(msg) {
  console.log(`  ${colors.dim}ℹ${colors.reset} ${msg}`);
}

// ─── HTTP helper ─────────────────────────────────────────────────────────
async function apiCall(url, cookie, token = null) {
  const headers = {
    'User-Agent': UA,
    'X-User-Agent': XUA,
    'Cookie': cookie,
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const resp = await fetch(url, { headers });
  const text = await resp.text();
  try {
    return { ok: resp.ok, json: JSON.parse(text), text };
  } catch {
    return { ok: resp.ok, json: null, text };
  }
}

// ─── Discover working endpoint ──────────────────────────────────────────
async function discoverEndpoint(base, mac, serial) {
  const cookie = `mac=${mac}; stb_lang=en; timezone=UTC; PHPSESSID=null${serial ? `; sn=${serial}` : ''}`;

  for (const ep of ENDPOINTS) {
    const url = `${base}${ep}?type=stb&action=handshake&prehash=0&token=&JsHttpRequest=1-xml`;
    try {
      const { json } = await apiCall(url, cookie);
      if (json && json.js && (json.js.token || json.js.Token)) {
        log(`Endpoint found: ${ep}`);
        return { endpoint: ep, cookie, token: json.js.token || json.js.Token };
      }
    } catch {}
  }

  // Fallback: try base directly
  for (const ep of ['', '/']) {
    const url = `${base}${ep}?type=stb&action=handshake&prehash=0&token=&JsHttpRequest=1-xml`;
    try {
      const { json } = await apiCall(url, `mac=${mac}; stb_lang=en; timezone=UTC`);
      if (json && json.js && (json.js.token || json.js.Token)) {
        log(`Endpoint found: (root) ${ep || '/'}`);
        return { endpoint: ep, cookie: `mac=${mac}; stb_lang=en; timezone=UTC`, token: json.js.token || json.js.Token };
      }
    } catch {}
  }

  return null;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log(`  ${colors.cyan}╔══════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`  ${colors.cyan}║              🅳🅰🅻🅾  v2.0 — Stalker to M3U        ║${colors.reset}`);
  console.log(`  ${colors.cyan}╚══════════════════════════════════════════════════╝${colors.reset}`);
  console.log('');
  console.log(`  ${colors.dim}•${colors.reset} Portal  : ${CFG.base}`);
  console.log(`  ${colors.dim}•${colors.reset} MAC     : ${CFG.mac}`);
  console.log(`  ${colors.dim}•${colors.reset} Output  : ${CFG.output}`);
  console.log('');

  // ─── Step 1: Discover endpoint & handshake ──────────────────────────
  logInfo('Discovering portal endpoint...');
  const portal = await discoverEndpoint(CFG.base, CFG.mac, CFG.serial);
  if (!portal) {
    log('Could not find working portal endpoint', false);
    console.log('');
    logInfo('Try using a different base URL or check if the portal is online');
    process.exit(1);
  }

  let { endpoint, cookie, token } = portal;
  cookie += `; sn=${CFG.serial}`;
  log(`Token obtained: ${token.substring(0, 16)}...`);

  // ─── Step 2: do_auth ────────────────────────────────────────────────
  if (CFG.device_id) {
    logInfo('Authenticating device...');
    const authUrl = `${CFG.base}${endpoint}?type=stb&action=do_auth` +
      `&login=&password=` +
      `&device_id=${encodeURIComponent(CFG.device_id)}` +
      `&device_id2=${encodeURIComponent(CFG.device_id2)}` +
      `&signature=${encodeURIComponent(CFG.signature)}` +
      `&sn=${encodeURIComponent(CFG.serial)}` +
      `&JsHttpRequest=1-xml`;

    const { json } = await apiCall(authUrl, cookie, token);
    if (json && json.js === true) {
      log('Device authenticated');
    } else if (json && json.js === false) {
      logInfo('Auth returned false — continuing anyway');
    } else {
      logInfo('Auth step completed (non-blocking)');
    }
  }

  // ─── Step 3: Get all channels ──────────────────────────────────────
  logInfo('Fetching channel list...');
  const chUrl = `${CFG.base}${endpoint}?type=itv&action=get_all_channels&force_ch_link_check=&JsHttpRequest=1-xml`;
  const { ok, json, text } = await apiCall(chUrl, cookie, token);

  if (!ok) {
    log(`HTTP ${text.substring(0, 100)}`, false);
    process.exit(1);
  }

  let channels = json?.js?.data;
  
  // If no data, try get_ordered_list instead
  if (!channels || channels.length === 0) {
    logInfo('get_all_channels returned empty, trying get_ordered_list...');
    const olUrl = `${CFG.base}${endpoint}?type=itv&action=get_ordered_list&force_ch_link_check=&fav=0&sortby=number&p=1&JsHttpRequest=1-xml`;
    const { json: olJson } = await apiCall(olUrl, cookie, token);
    channels = olJson?.js?.data;
  }

  if (!channels || channels.length === 0) {
    log('No channels found — portal may require different parameters', false);
    logInfo(`Raw response: ${JSON.stringify(json?.js).substring(0, 300)}`);
    process.exit(1);
  }

  log(`${channels.length} channels found`);

  // ─── Step 4: Get stream URLs via create_link ───────────────────────
  logInfo('Generating stream URLs...');
  const m3uLines = ['#EXTM3U'];
  let working = 0;
  let failed = 0;

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    const name = ch.name || `Channel ${ch.id || i}`;
    const logo = ch.logo || '';
    const cmd = ch.cmd || ch.cmds?.[0]?.url || '';

    let streamUrl = cmd;

    // Try to get real stream URL via create_link if cmd looks like a reference
    if (cmd && !cmd.startsWith('http')) {
      const linkUrl = `${CFG.base}${endpoint}?action=create_link&type=itv&cmd=${encodeURIComponent(cmd)}&JsHttpRequest=1-xml`;
      try {
        const { json: linkJson } = await apiCall(linkUrl, cookie, token);
        if (linkJson?.js?.cmd) {
          // Extract URL from cmd (format: "ffmpeg http://..." or just "http://...")
          const rawCmd = linkJson.js.cmd;
          const urlMatch = rawCmd.match(/https?:\/\/[^\s]+/);
          streamUrl = urlMatch ? urlMatch[0] : rawCmd;
          working++;
        }
      } catch {
        failed++;
      }
    } else if (cmd.startsWith('http')) {
      streamUrl = cmd;
      working++;
    } else {
      failed++;
    }

    if (i < 5 || i % 10 === 0 || i === channels.length - 1) {
      process.stdout.write(`\r  Processing: ${i + 1}/${channels.length} [✓ ${working} | ✗ ${failed}]`);
    }

    m3uLines.push(
      `#EXTINF:-1 tvg-id="${ch.id || i}" tvg-name="${name.replace(/,/g, '')}" tvg-logo="${logo}",${name}`
    );
    m3uLines.push(streamUrl || '# No stream URL');
  }

  console.log('\n');

  // ─── Step 5: Save playlist ─────────────────────────────────────────
  const playlist = m3uLines.join('\n');
  fs.writeFileSync(CFG.output, playlist, 'utf-8');

  log(`Saved to ${CFG.output}`);
  log(`${channels.length} channels total, ${working} with stream URLs`);
  console.log('');
  console.log(`  ${colors.dim}Playlist URL (for VLC/TiviMate):${colors.reset}`);
  console.log(`  ${colors.green}${path.resolve(CFG.output)}${colors.reset}`);
  console.log('');
}

main().catch(err => {
  console.error('  ✗ Fatal error:', err.message);
  process.exit(1);
});
