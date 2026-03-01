/**
 * Slack integration — Bot Token API
 * Requires: Bot Token (xoxb-...) with channels:read, chat:write, im:history, channels:history scopes
 */
import * as https from 'https';
import { registerIntegration, type AppMessage } from './integration-manager';

function slackGet<T>(token: string, method: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ ...params }).toString();
  const urlPath = `/api/${method}${qs ? '?' + qs : ''}`;
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: 'slack.com', path: urlPath, method: 'GET',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
      res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (!parsed.ok) reject(new Error(parsed.error || 'Slack API error'));
            else resolve(parsed as T);
          } catch { reject(new Error('Invalid JSON response')); }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function slackPost<T>(token: string, method: string, body: Record<string, unknown>): Promise<T> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: 'slack.com', path: `/api/${method}`, method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload) } },
      res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (!parsed.ok) reject(new Error(parsed.error || 'Slack API error'));
            else resolve(parsed as T);
          } catch { reject(new Error('Invalid JSON response')); }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

registerIntegration({
  id: 'slack',
  name: 'Slack',
  description: 'Team messaging — channels, DMs, notifications',
  icon: '◈',
  setupFields: [
    { key: 'botToken', label: 'Bot Token (xoxb-...)', secret: true,
      hint: 'Slack App → OAuth & Permissions → Bot User OAuth Token' },
  ],

  async fetchMessages(config, limit = 20): Promise<AppMessage[]> {
    const { botToken } = config;
    const chRes = await slackGet<{ channels: Array<{ id: string; name: string; is_im: boolean }> }>(
      botToken, 'conversations.list', { types: 'public_channel,private_channel,im', limit: '20' }
    );
    const messages: AppMessage[] = [];
    for (const ch of (chRes.channels ?? []).slice(0, 5)) {
      try {
        const histRes = await slackGet<{ messages: Array<{ ts: string; text: string; user?: string }> }>(
          botToken, 'conversations.history', { channel: ch.id, limit: String(Math.ceil(limit / 5)) }
        );
        for (const m of histRes.messages ?? []) {
          messages.push({
            id: m.ts,
            from: m.user ?? 'unknown',
            channel: ch.is_im ? 'DM' : `#${ch.name}`,
            text: m.text ?? '',
            timestamp: new Date(parseFloat(m.ts) * 1000).toISOString(),
          });
        }
      } catch { /* skip inaccessible channels */ }
    }
    return messages.slice(0, limit);
  },

  async sendMessage(config, channel, text): Promise<void> {
    await slackPost(config.botToken, 'chat.postMessage', { channel, text });
  },

  async fetchNotifications(config): Promise<AppMessage[]> {
    // Return DMs as notifications
    const chRes = await slackGet<{ channels: Array<{ id: string; name: string }> }>(
      config.botToken, 'conversations.list', { types: 'im', limit: '10' }
    );
    const msgs: AppMessage[] = [];
    for (const ch of (chRes.channels ?? []).slice(0, 5)) {
      try {
        const h = await slackGet<{ messages: Array<{ ts: string; text: string; user?: string }> }>(
          config.botToken, 'conversations.history', { channel: ch.id, limit: '3' }
        );
        for (const m of h.messages ?? []) {
          msgs.push({ id: m.ts, from: m.user ?? 'unknown', channel: 'DM',
            text: m.text ?? '', timestamp: new Date(parseFloat(m.ts) * 1000).toISOString() });
        }
      } catch {}
    }
    return msgs;
  },
});
