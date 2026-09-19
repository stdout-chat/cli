// Thin fetch helpers for the #void HTTP contract. No retries here; the
// session decides. Every failure becomes an ApiError with a human `message`.

export const DEFAULT_API = 'https://api.stdout.chat';

export class ApiError extends Error {
  constructor(message, { status = 0, code = null, until = null, retryAfter = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.until = until;
    this.retryAfter = retryAfter;
  }
}

function normalizeBase(base) {
  let b = String(base || DEFAULT_API).trim();
  if (!/^https?:\/\//i.test(b)) b = `https://${b}`;
  return b.replace(/\/+$/, '');
}

async function toError(res) {
  let text = '';
  try { text = await res.text(); } catch { /* body unreadable */ }
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* not json */ }
  const retryHeader = Number(res.headers.get('retry-after'));
  const retryAfter = Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : null;
  if (parsed && typeof parsed === 'object' && typeof parsed.message === 'string' && parsed.message) {
    return new ApiError(parsed.message, {
      status: res.status,
      code: typeof parsed.error === 'string' ? parsed.error : null,
      until: parsed.until == null ? null : parsed.until,
      retryAfter: parsed.retry_after == null ? retryAfter : Number(parsed.retry_after),
    });
  }
  const plain = text.replace(/\s+/g, ' ').trim();
  return new ApiError(plain || `http ${res.status}`, { status: res.status, retryAfter });
}

function networkError(err) {
  if (err && err.name === 'AbortError') throw err;
  const cause = err && err.cause;
  const detail = (cause && (cause.code || cause.message)) || (err && err.message) || String(err);
  return new ApiError(`network error · ${detail}`, { status: 0, code: 'network' });
}

export function createApi({ base = DEFAULT_API, version = '0.0.0', fetchImpl = null } = {}) {
  const root = normalizeBase(base);
  const userAgent = `stdout-chat-cli/${version} node/${process.version}`;
  const doFetch = (url, init) => (fetchImpl || globalThis.fetch)(url, init);

  function headers(extra = {}, key = null) {
    const h = { Accept: 'application/json', 'User-Agent': userAgent, ...extra };
    if (key) h.Authorization = `Bearer ${key}`;
    return h;
  }

  async function json(url, init) {
    let res;
    try { res = await doFetch(url, init); } catch (err) { throw networkError(err); }
    if (!res.ok) throw await toError(res);
    try { return await res.json(); } catch { throw new ApiError('bad response · not json', { status: res.status }); }
  }

  return {
    base: root,
    userAgent,

    /** GET /void?n=N → { topic, count, top_week, messages } */
    getVoid(n = 30) {
      const count = Math.max(1, Math.min(100, Number(n) || 30));
      return json(`${root}/void?n=${count}`, { headers: headers() });
    },

    /** GET /void/me with Bearer → { username, tag, top?, week? } */
    getMe(key) {
      return json(`${root}/void/me`, { headers: headers({}, key) });
    },

    /** POST /void {text, reply?} → 201 { id, sid, username, text, ts } */
    post({ text, reply } = {}, key) {
      const body = { text: String(text) };
      if (reply) body.reply = String(reply);
      return json(`${root}/void`, {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json' }, key),
        body: JSON.stringify(body),
      });
    },

    /** GET /void/stream → Response (200, body is a ReadableStream). Throws ApiError on non-2xx. */
    async openStream({ lastEventId = null, signal = null } = {}) {
      const extra = { 'Cache-Control': 'no-cache' };
      if (lastEventId != null && lastEventId !== '') extra['Last-Event-ID'] = String(lastEventId);
      let res;
      try {
        res = await doFetch(`${root}/void/stream`, { headers: headers(extra), signal });
      } catch (err) {
        throw networkError(err);
      }
      if (!res.ok) throw await toError(res);
      if (!res.body) throw new ApiError('stream has no body', { status: res.status });
      return res;
    },
  };
}

/** Human message for any thrown value — never a stack trace. */
export function errorMessage(err) {
  if (err instanceof ApiError) return err.message;
  if (err && typeof err.message === 'string' && err.message) return err.message;
  return String(err);
}
