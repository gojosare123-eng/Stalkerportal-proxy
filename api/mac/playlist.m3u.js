const portal = 'http://livebox.pro:80';
const mac = '00:1A:79:BE:B2:2A';
const serial = '7A1DE24D58D09';
const devId1 = '57E5D445136970ACB5AFCE3A1AE6B518C249C8C06AB34906332C361A79E33B03';
const devId2 = '3A599F57B7AAF0C10D9EB819D84DBF5C4D249280489E37B255BD5CFB961597B8';
const signature = 'FA7708B8ED654721748BA69C22E63BD4CB5EF1EF425ABC8FC364DEDF87C55629';

const userAgent = 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250 mag325 r11';

async function handshake(portalServer) {
  try {
    const response = await fetch(`${portalServer}/stalker_portal/server/load.php?type=stb&action=handshake&token=&JsHttpRequest=1-xml`, {
      headers: {
        'User-Agent': userAgent,
        'X-User-Agent': 'Model: MAG525; Link: WiFi',
        'Authorization': 'Bearer ',
        'Cookie': `mac=${encodeURIComponent(mac)}`,
        'Referer': portal + '/'
      }
    });

    const text = await response.text();
    console.log('Handshake response:', text.substring(0, 200));

    let token = '';
    try {
      const json = JSON.parse(text.replace('/*', '').replace('*/', ''));
      token = json?.js?.token || '';
    } catch (error) {
      console.error('Error parsing handshake response:', error);
    }

    if (!token) {
      console.log('Creating token...');
      const createTokenResponse = await fetch(`${portalServer}/stalker_portal/server/load.php?type=stb&action=create_token&token=&JsHttpRequest=1-xml`, {
        headers: {
          'User-Agent': userAgent,
          'Referer': portal + '/',
          'Cookie': `mac=${encodeURIComponent(mac)}`
        }
      });

      const createTokenText = await createTokenResponse.text();
      const createTokenJson = JSON.parse(createTokenText.replace('/*', '').replace('*/', ''));
      token = createTokenJson?.js?.token || '';
    }

    console.log('Token:', token);
    return token;
  } catch (error) {
    console.error('Error during handshake:', error);
    return null;
  }
}

async function getProfile(portalServer, token) {
  try {
    const response = await fetch(`${portalServer}/stalker_portal/server/load.php?type=account_info&action=get_main_info&JsHttpRequest=1-xml`, {
      headers: {
        'User-Agent': userAgent,
        'Authorization': `Bearer ${token}`,
        'Cookie': `mac=${encodeURIComponent(mac)}; token=${token}`,
        'Referer': portal + '/'
      }
    });

    const text = await response.text();
    console.log('Profile:', text.substring(0, 300));
    return text;
  } catch (error) {
    console.error('Error getting profile:', error);
    return null;
  }
}

async function getChannels(portalServer, token) {
  try {
    const response = await fetch(`${portalServer}/stalker_portal/server/load.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml`, {
      headers: {
        'User-Agent': userAgent,
        'Authorization': `Bearer ${token}`,
        'Cookie': `mac=${encodeURIComponent(mac)}; token=${token}`,
        'Referer': portal + '/'
      }
    });

    const text = await response.text();
    console.log('Channels response:', text.substring(0, 200));

    let channels = [];
    try {
      const json = JSON.parse(text.replace(/\/\*([\s\S]*?)\*\//, '$1'));
      channels = json.js?.data || json?.data || [];
    } catch (error) {
      console.error('Error parsing channels response:', error);
    }

    return channels;
  } catch (error) {
    console.error('Error getting channels:', error);
    return [];
  }
}

async function buildM3U(channels, portalServer) {
  let m3u = '#EXTM3U\n';

  for (const channel of channels) {
    const name = channel.name || `Channel ${channel.id || channel.channel_id || ''}`;
    const logo = channel.logo || channel.tv_logo || channel.stream_icon || '';
    const cmd = channel.cmd || '';
    const num = channel.number || '';

    let streamUrl = cmd;
    if (!streamUrl && channel.channel_id) {
      streamUrl = `${portalServer}/stalker_portal/server/load.php?type=itv&action=create_link&JsHttpRequest=1-xml&channel_id=${channel.channel_id}`;
    }

    if (streamUrl) {
      m3u += `#EXTINF:-1 tvg-id="${channel.channel_id || channel.id || ''}" tvg-name="${name.replace(/,/g, '')}" tvg-logo="${logo}" group-title="${channel.genres_name || channel.genre || 'General'}",${num ? num + '. ' : ''}${name}\n`;
      m3u += `${streamUrl}\n`;
    }
  }

  return m3u;
}

export default async function handler(req, res) {
  try {
    const portalServer = portal.replace('/c', '');
    const token = await handshake(portalServer);

    if (!token) {
      console.error('Failed to obtain token');
      res.status(500).send('#EXTM3U\n#EXTINF:-1,Error: Failed to obtain token\n');
      return;
    }

    await getProfile(portalServer, token);
    const channels = await getChannels(portalServer, token);

    if (channels.length === 0) {
      console.log('Trying alternative channel fetch...');
      const altResponse = await fetch(`${portalServer}/stalker_portal/server/load.php?type=itv&action=get_genres&JsHttpRequest=1-xml`, {
        headers: {
          'User-Agent': userAgent,
          'Authorization': `Bearer ${token}`,
          'Cookie': `mac=${encodeURIComponent(mac)}; token=${token}`,
          'Referer': portal + '/'
        }
      });
      console.log('Genres:', await altResponse.text().substring(0, 500));
    }

    const m3u = await buildM3U(channels, portalServer);

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(m3u);
  } catch (error) {
    console.error('Fatal error:', error);
    res.status(500).send('#EXTM3U\n#EXTINF:-1,Error: ' + error.message + '\n');
  }
}
