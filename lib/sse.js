// Pure Server-Sent Events parser (WHATWG EventSource line semantics), no I/O.
//
//   const p = new SSEParser();
//   p.feed('event: msg\nid: 12\ndata: {"a":1}\n\n')  // → [{ event: 'msg', id: '12', data: '{"a":1}' }]
//
// Handles events split across arbitrary chunk boundaries, LF / CRLF / CR line
// endings, `: comment` heartbeats, multi-line `data:` fields, and `retry:`.
// `id` on a yielded event is the *last seen* event id (spec behaviour), so an
// event without its own `id:` line inherits the previous one.

export class SSEParser {
  constructor() {
    this.buf = '';
    this.lastEventId = '';
    this.retry = null;
    this._event = '';
    this._data = [];
  }

  /** Feed a string chunk; returns an array of complete events (possibly empty). */
  feed(chunk) {
    if (!chunk) return [];
    this.buf += chunk;
    const out = [];
    let start = 0;
    for (;;) {
      let i = start;
      let term = -1;
      let len = 0;
      while (i < this.buf.length) {
        const c = this.buf.charCodeAt(i);
        if (c === 10) { term = i; len = 1; break; }
        if (c === 13) {
          // A trailing CR may be the first half of CRLF arriving in the next chunk.
          if (i + 1 >= this.buf.length) { term = -2; break; }
          term = i;
          len = this.buf.charCodeAt(i + 1) === 10 ? 2 : 1;
          break;
        }
        i++;
      }
      if (term < 0) break;
      const ev = this._line(this.buf.slice(start, term));
      if (ev) out.push(ev);
      start = term + len;
    }
    this.buf = this.buf.slice(start);
    return out;
  }

  /** Drop any partial event (spec: incomplete events at EOF are discarded). */
  reset() {
    this.buf = '';
    this._event = '';
    this._data = [];
  }

  _line(line) {
    if (line === '') return this._dispatch();
    if (line.charCodeAt(0) === 58) return null; // ':' comment
    let field;
    let value;
    const colon = line.indexOf(':');
    if (colon === -1) {
      field = line;
      value = '';
    } else {
      field = line.slice(0, colon);
      value = line.slice(colon + 1);
      if (value.charCodeAt(0) === 32) value = value.slice(1);
    }
    switch (field) {
      case 'event': this._event = value; break;
      case 'data': this._data.push(value); break;
      case 'id': if (!value.includes('\0')) this.lastEventId = value; break;
      case 'retry': if (/^\d+$/.test(value)) this.retry = Number(value); break;
      default: break; // unknown fields are ignored
    }
    return null;
  }

  _dispatch() {
    if (this._data.length === 0) {
      this._event = '';
      return null;
    }
    const ev = { event: this._event || 'message', id: this.lastEventId, data: this._data.join('\n') };
    this._event = '';
    this._data = [];
    return ev;
  }
}

/**
 * Async-iterate SSE events from a WHATWG ReadableStream of bytes (fetch body).
 * `onChunk` fires for every received chunk (used as a liveness watchdog).
 * Breaking out of the loop cancels the underlying stream.
 */
export async function* readEvents(body, { onChunk } = {}) {
  const parser = new SSEParser();
  const decoder = new TextDecoder('utf-8');
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (onChunk) onChunk();
      const events = parser.feed(decoder.decode(value, { stream: true }));
      for (const ev of events) yield ev;
    }
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }
}
