import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { spawn } from 'node:child_process';

const MAX_BODY = 1024 * 1024;

/** Fill in the check target from the service url when it isn't given. */
export function resolveCheck(service, settings) {
  const check = { ...service.check };
  check.timeout = Number(check.timeout) || settings.timeout;
  check.interval = Number(check.interval) || settings.checkInterval;
  if (!check.target && service.url) {
    const url = new URL(service.url);
    if (check.type === 'http') check.target = service.url;
    if (check.type === 'tcp') {
      const port = url.port || (url.protocol === 'https:' ? 443 : 80);
      check.target = `${url.hostname}:${port}`;
    }
    if (check.type === 'ping') check.target = url.hostname.replace(/^\[|\]$/g, '');
  }
  return check;
}

export async function runCheck(check) {
  const started = Date.now();
  let result;
  try {
    switch (check.type) {
      case 'http': result = await httpCheck(check); break;
      case 'tcp': result = await tcpCheck(check); break;
      case 'ping': result = await pingCheck(check); break;
      default: result = { status: 'none', message: 'Not monitored' };
    }
  } catch (err) {
    result = { status: 'down', message: err.message };
  }
  return { latency: null, ...result, checkedAt: started };
}

/**
 * expectStatus accepts 200, "200-299,401" or [200, "300-399"].
 * Without it: 2xx/3xx and 401/403 (auth walls) are up, other 4xx warn, 5xx down.
 */
export function classifyStatus(code, expect) {
  if (expect === undefined || expect === null || expect === '') {
    if (code < 400 || code === 401 || code === 403) return 'up';
    return code < 500 ? 'warn' : 'down';
  }
  const parts = (Array.isArray(expect) ? expect : String(expect).split(',')).map((p) => String(p).trim());
  const ok = parts.some((part) => {
    const [lo, hi] = part.split('-').map(Number);
    return hi ? code >= lo && code <= hi : code === lo;
  });
  return ok ? 'up' : 'down';
}

function httpCheck(check) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      req.destroy();
      resolve(r);
    };
    const url = new URL(check.target);
    const lib = url.protocol === 'https:' ? https : http;
    const start = performance.now();
    const req = lib.request(url, {
      method: check.method || 'GET',
      headers: { 'user-agent': 'dashpanel/1.0', accept: '*/*', ...check.headers },
      rejectUnauthorized: check.insecure === false,
      agent: false,
    }, (res) => {
      const latency = Math.round(performance.now() - start);
      const code = res.statusCode;
      let status = classifyStatus(code, check.expectStatus);
      if (!check.keyword || status === 'down') {
        return finish({ status, latency, code, message: `HTTP ${code}` });
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        if (body.includes(check.keyword)) finish({ status, latency, code, message: `HTTP ${code}, keyword found` });
        else if (body.length > MAX_BODY) res.destroy();
      });
      res.on('close', () => finish({ status: 'down', latency, code, message: `HTTP ${code}, keyword "${check.keyword}" not found` }));
    });
    const timer = setTimeout(() => finish({ status: 'down', message: `Timed out after ${check.timeout} ms` }), check.timeout);
    req.on('error', (err) => finish({ status: 'down', message: describeError(err) }));
    req.end();
  });
}

function parseHostPort(target) {
  const m = /^\[?([^\]]+?)\]?:(\d{1,5})$/.exec(target);
  if (!m) throw new Error(`Invalid tcp target "${target}" (expected host:port)`);
  return { host: m[1], port: Number(m[2]) };
}

function tcpCheck(check) {
  const { host, port } = parseHostPort(check.target);
  return new Promise((resolve) => {
    const start = performance.now();
    const socket = net.connect({ host, port });
    const finish = (r) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(r);
    };
    const timer = setTimeout(() => finish({ status: 'down', message: `Timed out after ${check.timeout} ms` }), check.timeout);
    socket.once('connect', () => finish({ status: 'up', latency: Math.round(performance.now() - start), message: `Port ${port} open` }));
    socket.once('error', (err) => finish({ status: 'down', message: describeError(err) }));
  });
}

function pingCheck(check) {
  const host = String(check.target);
  if (!/^[\w.:-]+$/.test(host) || host.startsWith('-')) throw new Error(`Invalid ping host "${host}"`);
  const win = process.platform === 'win32';
  const args = win
    ? ['-n', '1', '-w', String(check.timeout), host]
    : ['-c', '1', '-W', String(Math.max(1, Math.ceil(check.timeout / 1000))), host];
  return new Promise((resolve) => {
    const start = performance.now();
    let out = '';
    const child = spawn('ping', args, { windowsHide: true });
    const timer = setTimeout(() => child.kill(), check.timeout + 1000);
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ status: 'down', message: `ping unavailable: ${err.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      // Windows exits 0 for "Destination host unreachable", so look for an actual reply.
      const replied = win ? /TTL=/i.test(out) : code === 0;
      const time = /time[=<]\s*([\d.]+)\s*ms/i.exec(out);
      resolve(replied
        ? { status: 'up', latency: time ? Math.round(Number(time[1])) : Math.round(performance.now() - start), message: 'Ping reply' }
        : { status: 'down', message: 'No ping reply' });
    });
  });
}

function describeError(err) {
  const map = {
    ECONNREFUSED: 'Connection refused',
    EHOSTUNREACH: 'Host unreachable',
    ENETUNREACH: 'Network unreachable',
    ENOTFOUND: 'DNS lookup failed',
    ECONNRESET: 'Connection reset',
    ETIMEDOUT: 'Timed out',
    CERT_HAS_EXPIRED: 'TLS certificate expired',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'Self-signed TLS certificate (set insecure: true)',
  };
  return map[err.code] || err.message || String(err);
}
