const fetch = require('node-fetch');

// ─── CONFIG ────────────────────────────────────────────────────────────────
// These can come from env vars, query params, or be hardcoded per user
const PORTAL_BASE = process.env.PORTAL_BASE || 'http://fastshare1.com';
const MAC         = process.env.MAC         || '00:1A:79:00:00:AB';

// Device metadata (from your scan output — needed for do_auth step)
const DEVICE_SERIAL   = process.env.SERIAL   || 'e563827bf816922617eeb4cc9100be92';
const DEVICE_ID_1     = process.env.DEVICE_ID || 'E08C16913E4230E2F374BACE769DB9D539E5AFCE37F9CD1CEADFF0A442E5A474';
const DEVICE_ID_2     = process.env.DEVICE_ID2 || 'E08C16913E4230E2F374BACE769DB9D539E5AFCE37F9CD1CEADFF0A442E5A474';
const DEVICE_SIGNATURE = process.env.SIGNATURE || 'A3EE5C98FD598613A780B944CC1E170070B9A92A5BF0F5D3686B66384EDA7882';
// ───────────────────────────────────────────────────────────────────────────

// Helper: build base cookie string
function buildCookie(mac, serial) {
  let cookie = `mac=${mac}; stb_lang=en; timezone=UTC; PHPSESSID=null`;
  if (serial) cookie += `; sn=${serial}`;
  return cookie;
}

module.exports = async (req, res) => {
  // ─── Allow dynamic MAC via query param ───
  const mac = req.query.mac || MAC;
  const serial = req.query.serial || DEVICE_SERIAL;
  const deviceId1 = req.query.device_id || DEVICE_ID_1;
  const deviceId2 = req.query.device_id2 || DEVICE_ID_2;
  const signature = req.query.signature || DEVICE_SIGNATURE;
  const base = req.query.base || PORTAL_BASE;

  const cookie = buildCookie(mac, serial);

  // ─── STEP 1: Handshake ─────────────────────────────────────────────────
  // Sends empty token first, server returns a valid token
  const handshakeUrl = `${base}/portal.php?type=stb&action=handshake&prehash=0&token=&JsHttpRequest=1-xml`;

  let resp = await fetch(handshakeUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG254 stbapp ver: 4 rev: 2116 Mobile Safari/533.3',
      'X-User-Agent': 'Model: MAG254; Link: Ethernet',
      'Cookie': cookie
    }
  });

  let text = await resp.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch (e) {
    // Some portals return malformed JSON. Try to extract token manually
    const match = text.match(/"token"\s*:\s*"([^"]+)"/i);
    if (match) {
      data = { js: { token: match[1] } };
    } else {
      return res.status(500).send(`# Handshake failed - raw response:\n${text}`);
    }
  }

  const token = data.js?.token || data.js?.Token;
  if (!token) {
    return res.status(500).send(`# No token received in handshake:\n${text}`);
  }

  // ─── STEP 2: Authenticate (do_auth) ────────────────────────────────────
  // This binds the device metadata to the session. CRITICAL for strict portals.
  const authUrl = `${base}/portal.php?type=stb&action=do_auth` +
    `&login=&password=` +
    `&device_id=${encodeURIComponent(deviceId1)}` +
    `&device_id2=${encodeURIComponent(deviceId2)}` +
    `&signature=${encodeURIComponent(signature)}` +
    `&sn=${encodeURIComponent(serial)}` +
    `&JsHttpRequest=1-xml`;

  resp = await fetch(authUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG254 stbapp ver: 4 rev: 2116 Mobile Safari/533.3',
      'X-User-Agent': 'Model: MAG254; Link: Ethernet',
      'Cookie': cookie,
      'Authorization': `Bearer ${token}`
    }
  });

  text = await resp.text();
  try {
    data = JSON.parse(text);
    console.log('[do_auth]', data);
  } catch (e) {
    // Non-fatal — some portals accept silently
    console.log('[do_auth raw]', text);
  }

  // ─── STEP 3: Get channel list ──────────────────────────────────────────
  const channelsUrl = `${base}/portal.php?type=itv&action=get_all_channels&force_ch_link_check=&JsHttpRequest=1-xml`;

  resp = await fetch(channelsUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG254 stbapp ver: 4 rev: 2116 Mobile Safari/533.3',
      'X-User-Agent': 'Model: MAG254; Link: Ethernet',
      'Cookie': cookie,
      'Authorization': `Bearer ${token}`
    }
  });

  text = await resp.text();

  if (resp.status !== 200) {
    return res.status(500).send(
      `# Portal returned HTTP ${resp.status}\n` +
      `# URL: ${channelsUrl}\n` +
      `# Token: ${token}\n` +
      `# MAC: ${mac}\n` +
      `# Response:\n${text}`
    );
  }

  let channelsData;
  try {
    channelsData = JSON.parse(text);
  } catch (e) {
    return res.status(500).send(`# Failed to parse channels JSON:\n${text}`);
  }

  const channels = channelsData.js?.data;
  if (!channels || !Array.isArray(channels)) {
    return res.status(500).send(
      `# No channel data found in response.\n` +
      `# Full response:\n${JSON.stringify(channelsData, null, 2)}`
    );
  }

  // ─── STEP 4: Build M3U playlist ────────────────────────────────────────
  const lines = ['#EXTM3U'];

  for (const ch of channels) {
    const name = ch.name || 'Unknown';
    const logo = ch.logo || '';
    const cmd = ch.cmds?.[0]?.url || ch.cmd || '';

    // EXTINF line
    lines.push(
      `#EXTINF:-1 ` +
      `tvg-id="${ch.id || ''}" ` +
      `tvg-name="${name.replace(/,/g, '')}" ` +
      `tvg-logo="${logo}",${name}`
    );

    // Stream URL
    if (cmd) {
      lines.push(cmd);
    } else {
      lines.push('# NO STREAM URL');
    }
  }

  const playlist = lines.join('\n');

  // Set proper headers for M3U download
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="playlist.m3u"`);
  res.status(200).send(playlist);
};
