/**
 * Gmail API client — terminal-native, no Mail.app, no osascript
 * Uses OAuth2 access token from google-auth.ts
 */
import * as https from 'https';
import { getValidToken } from './google-auth';

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  body: string;
  isRead: boolean;
}

function apiGet(path: string, token: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'gmail.googleapis.com',
      path,
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'AuraOS/1.0' },
    };
    https.get(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error(data)); }
      });
    }).on('error', reject);
  });
}

function apiPost(path: string, token: string, body: string, contentType = 'application/json'): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'gmail.googleapis.com',
      path,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType,
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'AuraOS/1.0',
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error(data)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function decodeBase64(str: string): string {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function getHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function extractBody(payload: Record<string, unknown>): string {
  const tryDecode = (data: string) => {
    try { return decodeBase64(data); } catch { return ''; }
  };

  // Direct body
  const body = payload.body as { data?: string } | undefined;
  if (body?.data) return tryDecode(body.data).slice(0, 3000);

  // Multipart
  const parts = payload.parts as Array<{ mimeType: string; body?: { data?: string }; parts?: unknown[] }> | undefined;
  if (parts) {
    // prefer text/plain
    const plain = parts.find(p => p.mimeType === 'text/plain');
    if (plain?.body?.data) return tryDecode(plain.body.data).slice(0, 3000);
    const html = parts.find(p => p.mimeType === 'text/html');
    if (html?.body?.data) {
      // strip HTML tags
      return tryDecode(html.body.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 3000);
    }
  }
  return '';
}

export async function fetchGmailInbox(maxResults = 20): Promise<GmailMessage[]> {
  const token = await getValidToken();

  // List messages
  const list = await apiGet(
    `/gmail/v1/users/me/messages?maxResults=${maxResults}&labelIds=INBOX`,
    token
  ) as { messages?: Array<{ id: string; threadId: string }> };

  if (!list.messages?.length) return [];

  const messages: GmailMessage[] = [];

  // Fetch each message (parallel, max 5 at once)
  const chunks = [];
  for (let i = 0; i < list.messages.length; i += 5) {
    chunks.push(list.messages.slice(i, i + 5));
  }

  for (const chunk of chunks) {
    const fetched = await Promise.all(
      chunk.map(m => apiGet(`/gmail/v1/users/me/messages/${m.id}?format=full`, token))
    );

    for (const msg of fetched) {
      const m = msg as {
        id: string;
        threadId: string;
        labelIds?: string[];
        snippet?: string;
        payload?: {
          headers: Array<{ name: string; value: string }>;
          body?: { data?: string };
          parts?: Array<{ mimeType: string; body?: { data?: string } }>;
        };
      };

      const headers = m.payload?.headers || [];
      messages.push({
        id:      m.id,
        threadId: m.threadId,
        from:    getHeader(headers, 'From'),
        to:      getHeader(headers, 'To'),
        subject: getHeader(headers, 'Subject') || '(no subject)',
        date:    getHeader(headers, 'Date'),
        snippet: m.snippet || '',
        body:    m.payload ? extractBody(m.payload as Record<string, unknown>) : '',
        isRead:  !(m.labelIds || []).includes('UNREAD'),
      });
    }
  }

  return messages;
}

export async function sendGmail(to: string, subject: string, body: string): Promise<void> {
  const token = await getValidToken();

  // Build RFC 2822 message
  const raw = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=utf-8`,
    `MIME-Version: 1.0`,
    '',
    body,
  ].join('\r\n');

  const encoded = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  await apiPost('/gmail/v1/users/me/messages/send', token, JSON.stringify({ raw: encoded }));
}

export async function getGmailProfile(): Promise<{ emailAddress: string; messagesTotal: number }> {
  const token = await getValidToken();
  const profile = await apiGet('/gmail/v1/users/me/profile', token) as {
    emailAddress: string;
    messagesTotal: number;
  };
  return profile;
}

// Format helpers
export function formatGmailList(msgs: GmailMessage[]): string {
  if (!msgs.length) return '  Inbox is empty.';
  return msgs.map((m, i) => {
    const read   = m.isRead ? '  ' : T_BOLD('● ');
    const idx    = String(i + 1).padStart(3);
    const from   = m.from.replace(/<[^>]+>/, '').trim().slice(0, 25).padEnd(25);
    const subj   = m.subject.slice(0, 38).padEnd(38);
    return `  ${read}${idx}  ${from}  ${subj}  ${m.date.slice(0, 16)}`;
  }).join('\n');
}

function T_BOLD(s: string) { return `\x1b[1m${s}\x1b[0m`; }

export function formatGmailMessage(m: GmailMessage): string {
  return [
    `From:    ${m.from}`,
    `To:      ${m.to}`,
    `Subject: ${m.subject}`,
    `Date:    ${m.date}`,
    '',
    '─'.repeat(60),
    '',
    m.body || m.snippet || '(empty)',
  ].join('\n');
}
