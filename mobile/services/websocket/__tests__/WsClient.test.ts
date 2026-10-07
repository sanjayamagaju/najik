import { fullJitterBackoff } from '@/utils/backoff';

import { type WebSocketLike, WsClient, type WsClientOptions, WsRequestError } from '../WsClient';

class MockSocket implements WebSocketLike {
  static instances: MockSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  closedWith: { code?: number; reason?: string } | null = null;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason?: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(public url: string) {
    MockSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number, reason?: string) {
    this.closedWith = { code, reason };
    this.readyState = 3;
  }
  // ── test helpers ──
  serverOpen() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(frame: object) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  serverClose(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  frames(): { type: string; id?: string; data?: Record<string, unknown> }[] {
    return this.sent.map((s) => JSON.parse(s));
  }
  lastFrame() {
    return this.frames()[this.frames().length - 1];
  }
}

const latest = () => MockSocket.instances[MockSocket.instances.length - 1] as MockSocket;
const flush = () => jest.advanceTimersByTimeAsync(0);

function makeClient(overrides: Partial<WsClientOptions> = {}) {
  const onAuthRejected = jest.fn();
  const refreshAccessToken = jest.fn(async () => 'refreshed-token');
  const client = new WsClient({
    url: 'wss://api.example.test/ws/v1/',
    getAccessToken: async () => 'access-token',
    refreshAccessToken,
    onAuthRejected,
    createSocket: (url) => new MockSocket(url),
    random: () => 0.5,
    ...overrides,
  });
  return { client, onAuthRejected, refreshAccessToken };
}

async function connect(client: WsClient, heartbeatSec = 25) {
  client.start();
  await flush();
  const socket = latest();
  socket.serverOpen();
  const auth = socket.frames()[0];
  socket.receive({
    type: 'ack',
    id: auth?.id,
    ok: true,
    data: {
      user_id: 'u1',
      session_id: 's1',
      server_time: '2026-10-07T09:41:00.000Z',
      heartbeat_sec: heartbeatSec,
    },
  });
  await flush();
  return socket;
}

beforeEach(() => {
  jest.useFakeTimers();
  MockSocket.instances = [];
});

afterEach(() => {
  jest.useRealTimers();
});

describe('WsClient: authentication', () => {
  it('sends the token in the first frame (never in the URL) and opens after the ack', async () => {
    const { client } = makeClient();
    const states: string[] = [];
    client.onStateChange((s) => states.push(s));
    const onAuth = jest.fn();
    client.onAuthenticated(onAuth);

    const socket = await connect(client);

    expect(socket.url).toBe('wss://api.example.test/ws/v1/');
    expect(socket.url).not.toContain('access-token');
    const [first, second] = socket.frames();
    expect(first).toEqual({
      type: 'auth',
      id: expect.any(String),
      data: { token: 'access-token' },
    });
    expect(second).toEqual({ type: 'app.state', data: { state: 'active' } });
    expect(client.getState()).toBe('open');
    expect(states).toEqual(['connecting', 'authenticating', 'open']);
    expect(onAuth).toHaveBeenCalledWith(expect.objectContaining({ heartbeat_sec: 25 }), {
      reconnect: false,
    });
  });

  it('drops the socket and reconnects when the auth ack does not arrive within 10 s', async () => {
    const { client } = makeClient();
    client.start();
    await flush();
    latest().serverOpen();
    await jest.advanceTimersByTimeAsync(9_999);
    expect(latest().closedWith).toBeNull();
    await jest.advanceTimersByTimeAsync(1);
    expect(MockSocket.instances[0]?.closedWith).not.toBeNull();
    expect(client.getState()).toBe('backoff');
    await jest.advanceTimersByTimeAsync(250); // random 0.5 × 500 ms
    expect(MockSocket.instances).toHaveLength(2);
  });

  it('logs out on an auth ack with token_invalid', async () => {
    const { client, onAuthRejected } = makeClient();
    client.start();
    await flush();
    const socket = latest();
    socket.serverOpen();
    socket.receive({
      type: 'ack',
      id: socket.frames()[0]?.id,
      ok: false,
      error: { code: 'token_invalid', message: 'bad' },
    });
    await flush();
    expect(onAuthRejected).toHaveBeenCalledWith('token_invalid');
    expect(client.getState()).toBe('stopped');
  });

  it('refreshes and reconnects on an auth ack with token_expired', async () => {
    const { client, refreshAccessToken } = makeClient();
    client.start();
    await flush();
    const socket = latest();
    socket.serverOpen();
    socket.receive({
      type: 'ack',
      id: socket.frames()[0]?.id,
      ok: false,
      error: { code: 'token_expired', message: 'exp' },
    });
    await flush();
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(MockSocket.instances).toHaveLength(2);
  });

  it('marks later connections as reconnects', async () => {
    const { client } = makeClient();
    const onAuth = jest.fn();
    client.onAuthenticated(onAuth);
    await connect(client);
    latest().serverClose(1001);
    await jest.advanceTimersByTimeAsync(250);
    const socket = latest();
    socket.serverOpen();
    socket.receive({
      type: 'ack',
      id: socket.frames()[0]?.id,
      ok: true,
      data: { heartbeat_sec: 25 },
    });
    await flush();
    expect(onAuth).toHaveBeenLastCalledWith(expect.anything(), { reconnect: true });
  });
});

describe('WsClient: requests and acks', () => {
  it('resolves with ack data', async () => {
    const { client } = makeClient();
    const socket = await connect(client);
    const promise = client.request('message.send', {
      conversation_id: 'c1',
      client_id: 'k1',
      body: 'hi',
    });
    const frame = socket.lastFrame();
    expect(frame).toMatchObject({ type: 'message.send', data: { client_id: 'k1' } });
    socket.receive({ type: 'ack', id: frame?.id, ok: true, data: { message: { id: 'm1' } } });
    await expect(promise).resolves.toEqual({ message: { id: 'm1' } });
  });

  it('rejects with the server error code and retry_after_sec', async () => {
    const { client } = makeClient();
    const socket = await connect(client);
    const promise = client.request('ping.send', { conversation_id: 'c1', client_id: 'k2' });
    socket.receive({
      type: 'ack',
      id: socket.lastFrame()?.id,
      ok: false,
      error: { code: 'rate_limited', message: 'slow', retry_after_sec: 4 },
    });
    await expect(promise).rejects.toMatchObject({ code: 'rate_limited', retryAfterSec: 4 });
  });

  it('rejects with ack_timeout when no ack arrives in time', async () => {
    const { client } = makeClient({ ackTimeoutMs: 10_000 });
    await connect(client);
    const promise = client.request('presence.subscribe', { user_ids: ['a'] });
    const assertion = expect(promise).rejects.toMatchObject({ code: 'ack_timeout' });
    await jest.advanceTimersByTimeAsync(10_000);
    await assertion;
  });

  it('rejects pending requests when the socket closes', async () => {
    const { client } = makeClient();
    const socket = await connect(client);
    const promise = client.request('message.send', {
      conversation_id: 'c',
      client_id: 'k',
      body: 'x',
    });
    socket.serverClose(1006);
    await expect(promise).rejects.toMatchObject({ code: 'disconnected' });
  });

  it('refuses requests while not connected', async () => {
    const { client } = makeClient();
    await expect(
      client.request('message.send', { conversation_id: 'c', client_id: 'k', body: 'x' }),
    ).rejects.toBeInstanceOf(WsRequestError);
    expect(client.send('typing', { conversation_id: 'c', state: 'start' })).toBe(false);
  });

  it('rejects frames larger than 64 KiB locally', async () => {
    const { client } = makeClient();
    await connect(client);
    await expect(
      client.request('message.send', {
        conversation_id: 'c',
        client_id: 'k',
        body: 'x'.repeat(70 * 1024),
      }),
    ).rejects.toMatchObject({ code: 'frame_too_large' });
  });
});

describe('WsClient: typed events', () => {
  it('dispatches server pushes to subscribers and supports unsubscribe', async () => {
    const { client } = makeClient();
    const socket = await connect(client);
    const handler = jest.fn();
    const off = client.on('typing', handler);
    socket.receive({
      type: 'typing',
      data: { conversation_id: 'c1', user_id: 'u2', state: 'start' },
    });
    expect(handler).toHaveBeenCalledWith({ conversation_id: 'c1', user_id: 'u2', state: 'start' });
    off();
    socket.receive({
      type: 'typing',
      data: { conversation_id: 'c1', user_id: 'u2', state: 'stop' },
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('a throwing subscriber does not break dispatch', async () => {
    const { client } = makeClient();
    const socket = await connect(client);
    const good = jest.fn();
    client.on('presence', () => {
      throw new Error('boom');
    });
    client.on('presence', good);
    socket.receive({ type: 'presence', data: { user_id: 'u2', online: true, last_seen_at: null } });
    expect(good).toHaveBeenCalled();
  });

  it('session.revoked notifies subscribers then logs out without reconnecting', async () => {
    const { client, onAuthRejected } = makeClient();
    const socket = await connect(client);
    const handler = jest.fn();
    client.on('session.revoked', handler);
    socket.receive({ type: 'session.revoked', data: {} });
    expect(handler).toHaveBeenCalled();
    expect(onAuthRejected).toHaveBeenCalledWith('session_revoked');
    await jest.advanceTimersByTimeAsync(60_000);
    expect(MockSocket.instances).toHaveLength(1);
  });
});

describe('WsClient: close codes', () => {
  it('4004 → forced logout, no reconnect', async () => {
    const { client, onAuthRejected } = makeClient();
    await connect(client);
    latest().serverClose(4004);
    expect(onAuthRejected).toHaveBeenCalledWith('ws_4004');
    expect(client.getState()).toBe('stopped');
    await jest.advanceTimersByTimeAsync(120_000);
    expect(MockSocket.instances).toHaveLength(1);
  });

  it('4003 → refresh the token, then reconnect immediately', async () => {
    const { client, refreshAccessToken } = makeClient();
    await connect(client);
    latest().serverClose(4003);
    await flush();
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(MockSocket.instances).toHaveLength(2);
  });

  it('4003 with a dead session stops the client', async () => {
    const { client } = makeClient({ refreshAccessToken: async () => null });
    await connect(client);
    latest().serverClose(4003);
    await flush();
    expect(client.getState()).toBe('stopped');
    expect(MockSocket.instances).toHaveLength(1);
  });

  it('4008 → backs off at least 5 s', async () => {
    const { client } = makeClient({ random: () => 0 });
    await connect(client);
    latest().serverClose(4008);
    await jest.advanceTimersByTimeAsync(4_999);
    expect(MockSocket.instances).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(MockSocket.instances).toHaveLength(2);
  });

  it.each([4001, 4009, 1001, 1006])('%i → reconnect with backoff', async (code) => {
    const { client } = makeClient({ random: () => 0.5 });
    await connect(client);
    latest().serverClose(code);
    expect(client.getState()).toBe('backoff');
    await jest.advanceTimersByTimeAsync(249);
    expect(MockSocket.instances).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(MockSocket.instances).toHaveLength(2);
  });

  it('backoff grows exponentially between failed attempts (bounded by the cap)', async () => {
    const { client } = makeClient({ random: () => 0.999 });
    client.start();
    await flush();
    // Each attempt fails immediately with an abnormal close.
    const delays: number[] = [];
    for (let attempt = 0; attempt < 8; attempt++) {
      latest().serverClose(1006);
      const before = MockSocket.instances.length;
      let waited = 0;
      while (MockSocket.instances.length === before) {
        await jest.advanceTimersByTimeAsync(50);
        waited += 50;
      }
      delays.push(waited);
    }
    for (let i = 0; i < delays.length; i++) {
      expect(delays[i]).toBeLessThanOrEqual(Math.min(30_000, 500 * 2 ** i) + 50);
    }
    expect(delays[5]).toBeGreaterThan(delays[1] as number);
  });
});

describe('fullJitterBackoff', () => {
  it('stays within [0, min(cap, base·2^attempt))', () => {
    const opts = { baseMs: 500, capMs: 30_000 };
    for (let attempt = 0; attempt < 20; attempt++) {
      const ceiling = Math.min(30_000, 500 * 2 ** attempt);
      expect(fullJitterBackoff(attempt, opts, () => 0)).toBe(0);
      const high = fullJitterBackoff(attempt, opts, () => 0.999999);
      expect(high).toBeLessThan(ceiling);
      expect(high).toBeGreaterThanOrEqual(ceiling * 0.99);
      for (let i = 0; i < 20; i++) {
        const v = fullJitterBackoff(attempt, opts);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(ceiling);
      }
    }
  });
});

describe('WsClient: heartbeat', () => {
  it('sends hb every heartbeat_sec and stays open while replies arrive', async () => {
    const { client } = makeClient();
    const socket = await connect(client, 25);
    await jest.advanceTimersByTimeAsync(25_000);
    const hb = socket.lastFrame();
    expect(hb).toMatchObject({ type: 'hb', id: expect.any(String) });
    socket.receive({ type: 'hb', id: hb?.id });
    await jest.advanceTimersByTimeAsync(10_000);
    expect(socket.closedWith).toBeNull();
    expect(client.getState()).toBe('open');
  });

  it('treats the socket as dead when no hb reply arrives within 10 s and reconnects', async () => {
    const { client } = makeClient();
    const socket = await connect(client, 25);
    await jest.advanceTimersByTimeAsync(25_000);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(socket.closedWith).not.toBeNull();
    expect(client.getState()).toBe('backoff');
    await jest.advanceTimersByTimeAsync(250);
    expect(MockSocket.instances).toHaveLength(2);
  });
});

describe('WsClient: token rotation', () => {
  it('pushes a refreshed token with a second auth frame instead of reconnecting', async () => {
    const { client } = makeClient();
    const socket = await connect(client);
    client.reauthenticate('rotated-token');
    const frame = socket.lastFrame();
    expect(frame).toMatchObject({ type: 'auth', data: { token: 'rotated-token' } });
    socket.receive({ type: 'ack', id: frame?.id, ok: true, data: {} });
    await flush();
    expect(MockSocket.instances).toHaveLength(1);
    expect(client.getState()).toBe('open');
  });

  it('a rejected re-auth ends the session', async () => {
    const { client, onAuthRejected } = makeClient();
    const socket = await connect(client);
    client.reauthenticate('bad');
    socket.receive({
      type: 'ack',
      id: socket.lastFrame()?.id,
      ok: false,
      error: { code: 'session_revoked', message: 'x' },
    });
    await flush();
    expect(onAuthRejected).toHaveBeenCalledWith('session_revoked');
  });
});

describe('WsClient: network and app state', () => {
  it('waits for the network instead of retrying, then reconnects immediately', async () => {
    const { client } = makeClient();
    await connect(client);
    client.setNetworkAvailable(false);
    latest().serverClose(1006);
    expect(client.getState()).toBe('offline');
    await jest.advanceTimersByTimeAsync(60_000);
    expect(MockSocket.instances).toHaveLength(1);
    client.setNetworkAvailable(true);
    await flush();
    expect(MockSocket.instances).toHaveLength(2);
  });

  it('sends app.state frames and reconnects at once on foreground', async () => {
    const { client } = makeClient({ random: () => 0.999 });
    const socket = await connect(client);
    client.setAppState('background');
    expect(socket.lastFrame()).toEqual({ type: 'app.state', data: { state: 'background' } });
    socket.serverClose(1006);
    expect(client.getState()).toBe('backoff');
    client.setAppState('active');
    await flush();
    expect(MockSocket.instances).toHaveLength(2);
  });

  it('stop() closes the socket and never reconnects', async () => {
    const { client } = makeClient();
    const socket = await connect(client);
    client.stop();
    expect(socket.closedWith?.code).toBe(1000);
    await jest.advanceTimersByTimeAsync(120_000);
    expect(MockSocket.instances).toHaveLength(1);
    expect(client.getState()).toBe('stopped');
  });
});
