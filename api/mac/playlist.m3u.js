export default async function handler(req, res) {
  try {
    const portal = 'http://livebox.pro:80';
    const mac = '00:1A:79:BE:B2:2A';
    const serial = '7A1DE24D58D09';
    const devId1 = '57E5D445136970ACB5AFCE3A1AE6B518C249C8C06AB34906332C361A79E33B03';
    const devId2 = '3A599F57B7AAF0C10D9EB819D84DBF5C4D249280489E37B255BD5CFB961597B8';
    const signature = 'FA7708B8ED654721748BA69C22E63BD4CB5EF1EF425ABC8FC364DEDF87C55629';
    const portalServer = portal.replace('/c', '');

    // Step 1: Handshake
    console.log('Handshake...');
    const hsResp = await fetch(
      `${portalServer}/stalker_portal/server/load.php?type=stb&action=handshake&token=&JsHttpRequest=1-xml`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250 mag325 r11',
          'X-User-Agent': 'Model: MAG525; Link: WiFi',
          'Authorization': 'Bearer ',
          'Cookie': 'mac=' + encodeURIComponent(mac),
          'Referer': portal + '/'
        }
      }
    );
    const hsText = await hsResp.text();
    console.log('Handshake response:', hsText.substring(0, 200));

    // Extract token
    let token = '';
    try {
      const hsJson = JSON.parse(hsText.replace('/*', '').replace('*/', ''));
      token = hsJson?.js?.token || '';
    } catch(e) {
      // Try to find token in response
      const match = hsText.match(/token["':\s]+["']?([^"'\s,}]+)/);
      token = match ? match[1] : '';
    }

    if (!token) {
      // Try generating token via create_token
      console.log('Creating token...');
      const ctResp = await fetch(
        `${portalServer}/stalker_portal/server/load.php?type=stb&action=create_token&token=&JsHttpRequest=1-xml`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3',
            'Referer': portal + '/',
            'Cookie': 'mac=' + encodeURIComponent(mac)
          }
        }
      );
      const ctText = await ctResp.text();
      const ctJson = JSON.parse(ctText.replace('/*', '').replace('*/', ''));
      token = ctJson?.js?.token || '';
    }

    console.log('Token:', token);

    // Step 2: Get profile (account info)
    console.log('Getting profile...');
    const profileResp = await fetch(
      `${portalServer}/stalker_portal/server/load.php?type=account_info&action=get_main_info&JsHttpRequest=1-xml`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3',
          'Authorization': 'Bearer ' + token,
          'Cookie': 'mac=' + encodeURIComponent(mac) + '; token=' + token,
          'Referer': portal + '/'
        }
      }
    );
    const profileText = await profileResp.text();
    console.log('Profile:', profileText.substring(0, 300));

    // Step 3: Get all channels
    console.log('Getting channels...');
    const chResp = await fetch(
      `${portalServer}/stalker_portal/server/load.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3',
          'Authorization': 'Bearer ' + token,
          'Cookie': 'mac=' + encodeURIComponent(mac) + '; token=' + token,
          'Referer': portal + '/'
        }
      }
    );
    const chText = await chResp.text();
    console.log('Channels response:', chText.substring(0, 200));

    // Parse channels
    let channels = [];
    try {
      const cleanJson = chText.replace(/\/\*([\s\S]*?)\*\//, '$1');
      const chJson = JSON.parse(cleanJson);
      channels = chJson.js?.data || chJson?.data || [];
    } catch(e) {
      console.error('Parse error:', e.message);
    }

    // Build M3U
    let m3u = '#EXTM3U\n';
    
    for (const ch of channels) {
      const name = ch.name || `Channel ${ch.id || ch.channel_id || ''}`;
      const logo = ch.logo || ch.tv_logo || ch.stream_icon || '';
      const cmd = ch.cmd || '';
      const num = ch.number || '';
      
      // Stream URL is usually in cmd field or constructed
      let streamUrl = cmd;
      if (!streamUrl && ch.channel_id) {
        streamUrl = `${portalServer}/stalker_portal/server/load.php?type=itv&action=create_link&JsHttpRequest=1-xml&channel_id=${ch.channel_id}`;
      }
      
      if (streamUrl) {
        m3u += `#EXTINF:-1 tvg-id="${ch.channel_id || ch.id || ''}" tvg-name="${name.replace(/,/g, '')}" tvg-logo="${logo}" group-title="${ch.genres_name || ch.genre || 'General'}",${num ? num + '. ' : ''}${name}\n`;
        m3u += `${streamUrl}\n`;
      }
    }

    // If no channels from API, try alternative method
    if (channels.length === 0) {
      console.log('Trying alternative channel fetch...');
      const altResp = await fetch(
        `${portalServer}/stalker_portal/server/load.php?type=itv&action=get_genres&JsHttpRequest=1-xml`,
        { headers: {
          'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3',
          'Authorization': 'Bearer ' + token,
          'Cookie': 'mac=' + encodeURIComponent(mac) + '; token=' + token,
          'Referer': portal + '/'
        }}
      );
      console.log('Genres:', await altResp.text().substring(0, 500));
    }

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(m3u);

  } catch(e) {
    console.error('Fatal error:', e);
    res.status(500).send('#EXTM3U\n#EXTINF:-1,Error: ' + e.message + '\n');
  }
}
