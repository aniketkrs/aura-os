/**
 * Telegram integration — Bot API (getUpdates + sendMessage)
 * Requires: Bot Token from @BotFather
 */
import * as https from 'https';
import { registerIntegration, type AppMessage } from './integration-manager';

function tgRequest<T>(token: string, method: string, body?: Record<string, unknown>): Promise<T> {
  const payload = body ? JSON.stringify(body) : undefined;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${token}/${method}`,
        method: payload ? 'POST' : 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (!parsed.ok) reject(new Error(parsed.description || 'Telegram API error'));
            else resolve(parsed.result as T);
          } catch { reject(new Error('Invalid JSON response')); }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

interface TgUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { first_name?: string; username?: string; id: number };
    chat: { id: number; type: string; title?: string; username?: string; first_name?: string };
    date: number;
    text?: string;
  };
}

registerIntegration({
  id: 'telegram',
  name: 'Telegram',
  description: 'Bot messages — getUpdates, sendMessage',
  icon: '⊕',
  setupFields: [
    { key: 'botToken', label: 'Bot Token', secret: true,
      hint: 'Message @BotFather on Telegram → /newbot → copy the token' },
  ],

  async fetchMessages(config, limit = 20): Promise<AppMessage[]> {
    const updates = await tgRequest<TgUpdate[]>(config.botToken, 'getUpdates',
      { offset: 0, limit, timeout: 0 });
    return (updates ?? [])
      .filter(u => u.message?.text)
      .map(u => {
        const m = u.message!;
        const from = m.from?.first_name ?? m.from?.username ?? String(m.from?.id ?? 'unknown');
        const channel = m.chat.type === 'private'
          ? `DM:${m.chat.first_name ?? m.chat.username ?? m.chat.id}`
          : m.chat.title ?? String(m.chat.id);
        return {
          id: String(u.update_id),
          from,
          channel,
          text: m.text ?? '',
          timestamp: new Date(m.date * 1000).toISOString(),
        };
      })
      .slice(0, limit);
  },

  async sendMessage(config, chatId, text): Promise<void> {
    await tgRequest(config.botToken, 'sendMessage', { chat_id: chatId, text });
  },

  async fetchNotifications(config): Promise<AppMessage[]> {
    // Same as fetchMessages for Telegram — all updates are "notifications"
    const updates = await tgRequest<TgUpdate[]>(config.botToken, 'getUpdates',
      { offset: 0, limit: 10, timeout: 0 });
    return (updates ?? [])
      .filter(u => u.message?.text)
      .map(u => {
        const m = u.message!;
        return {
          id: String(u.update_id),
          from: m.from?.first_name ?? String(m.from?.id ?? 'bot'),
          channel: String(m.chat.id),
          text: m.text ?? '',
          timestamp: new Date(m.date * 1000).toISOString(),
        };
      });
  },
});
