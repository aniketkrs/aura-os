/**
 * Discord integration — REST API v10 (Bot Token)
 * Requires: Bot Token from Discord Developer Portal + channel ID in config
 */
import * as https from 'https';
import { registerIntegration, type AppMessage } from './integration-manager';

function discordRequest<T>(
  token: string,
  method: string,
  urlPath: string,
  body?: Record<string, unknown>
): Promise<T> {
  const payload = body ? JSON.stringify(body) : undefined;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'discord.com',
        path: `/api/v10${urlPath}`,
        method,
        headers: {
          Authorization: `Bot ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'AuraOS/1.0',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          if (res.statusCode === 204) { resolve(undefined as T); return; }
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(parsed.message ?? `Discord API error ${res.statusCode}`));
            } else {
              resolve(parsed as T);
            }
          } catch { reject(new Error('Invalid JSON response')); }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

interface DcMessage {
  id: string;
  content: string;
  timestamp: string;
  author: { username: string; id: string };
  channel_id: string;
}

interface DcChannel {
  id: string;
  name?: string;
  type: number;
}

registerIntegration({
  id: 'discord',
  name: 'Discord',
  description: 'Server channels — fetch messages, send, list channels',
  icon: '◎',
  setupFields: [
    { key: 'botToken', label: 'Bot Token', secret: true,
      hint: 'Discord Developer Portal → your App → Bot → Token' },
    { key: 'channelId', label: 'Default Channel ID', secret: false,
      hint: 'Right-click channel in Discord → Copy Channel ID (enable Developer Mode first)' },
    { key: 'guildId', label: 'Server (Guild) ID (optional)', secret: false,
      hint: 'Right-click server icon → Copy Server ID' },
  ],

  async fetchMessages(config, limit = 20): Promise<AppMessage[]> {
    const { botToken, channelId } = config;
    const msgs = await discordRequest<DcMessage[]>(
      botToken, 'GET', `/channels/${channelId}/messages?limit=${Math.min(limit, 100)}`
    );
    return (msgs ?? []).map(m => ({
      id: m.id,
      from: m.author.username,
      channel: `#${channelId}`,
      text: m.content,
      timestamp: m.timestamp,
    }));
  },

  async sendMessage(config, channelId, text): Promise<void> {
    const target = channelId || config.channelId;
    await discordRequest(config.botToken, 'POST', `/channels/${target}/messages`, { content: text });
  },

  async fetchNotifications(config): Promise<AppMessage[]> {
    // Fetch from all text channels in the guild if guildId provided
    if (!config.guildId) return [];
    const channels = await discordRequest<DcChannel[]>(
      config.botToken, 'GET', `/guilds/${config.guildId}/channels`
    );
    const textChannels = (channels ?? []).filter(c => c.type === 0).slice(0, 5); // type 0 = GUILD_TEXT
    const msgs: AppMessage[] = [];
    for (const ch of textChannels) {
      try {
        const recent = await discordRequest<DcMessage[]>(
          config.botToken, 'GET', `/channels/${ch.id}/messages?limit=3`
        );
        for (const m of recent ?? []) {
          msgs.push({ id: m.id, from: m.author.username, channel: `#${ch.name ?? ch.id}`,
            text: m.content, timestamp: m.timestamp });
        }
      } catch {}
    }
    return msgs;
  },
});
