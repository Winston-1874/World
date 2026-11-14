const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { gunzipSync } = require('node:zlib');
const path = require('node:path');
const Etat = require('../../js/etat.js');

async function serveur(env = {}) {
  const child = spawn(process.execPath, ['serveur/serveur.js'], { cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', AUTHORITATIVE: '1', AUTH_SPAWN_SECONDS: '2', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    let out = '', err = '';
    const timeout = setTimeout(() => reject(Error('Serveur indisponible ' + err)), 10000);
    child.stderr.on('data', b => { err += b; });
    child.on('error', reject);
    child.once('exit', () => { clearTimeout(timeout); reject(Error('Serveur arrêté ' + err)); });
    child.stdout.on('data', b => { out += b; const m = out.match(/ws:\/\/127\.0\.0\.1:\d+\/ws/); if (m) { clearTimeout(timeout); resolve(m[0]); } });
  });
  return { url, child, async close() {
    if (child.exitCode === null) { const exit = once(child, 'exit'); child.kill(); await exit; }
  } };
}

class Client {
  constructor(url) {
    this.ws = new WebSocket(url); this.ws.binaryType = 'arraybuffer';
    this.messages = []; this.attentes = []; this.ack = true; this.octets = 0;
    this.ws.addEventListener('message', e => {
      try {
        if (typeof e.data === 'string') {
          const m = JSON.parse(e.data); this.messages.push(m); if (this.messages.length > 200) this.messages.shift();
          if (m.t === 'start') this.start = m;
          if (m.t === 'state') this.transfer = { ...m, parts: [], offset: 0, index: 0 };
        } else {
          const f = this.transfer, b = Buffer.from(e.data);
          f.parts.push(b); f.offset += b.length; this.octets += b.length;
          if (f.offset === f.bytes) {
            this.state = Etat.appliquer(gunzipSync(Buffer.concat(f.parts)), this.state);
            if (this.onState) this.onState(this.state);
          }
          if (this.ack) this.send({ t: 'stateAck', transfer: f.transfer, index: f.index++ });
        }
        this.verifier();
      } catch (e) { this.erreur = e; this.verifier(); }
    });
  }
  async open(langue = 'en') { await once(this.ws, 'open'); this.send({ t: 'hello', protocol: 2, name: 'Royaume', banner: 0, langue }); return this; }
  send(m) { this.ws.send(JSON.stringify(m)); }
  wait(test, ms = 15000) {
    if (this.erreur) return Promise.reject(this.erreur);
    if (test(this)) return Promise.resolve(this);
    return new Promise((resolve, reject) => {
      const a = { test, resolve, reject }; a.timer = setTimeout(() => { this.attentes = this.attentes.filter(x => x !== a); reject(Error('Condition absente')); }, ms);
      this.attentes.push(a);
    });
  }
  verifier() {
    for (const a of [...this.attentes]) if (this.erreur || a.test(this)) {
      clearTimeout(a.timer); this.attentes = this.attentes.filter(x => x !== a);
      if (this.erreur) a.reject(this.erreur); else a.resolve(this);
    }
  }
  async message(t) { await this.wait(c => c.messages.some(m => m.t === t)); return this.messages.splice(this.messages.findIndex(m => m.t === t), 1)[0]; }
  close() { this.ws.close(); for (const a of this.attentes) clearTimeout(a.timer); }
}
module.exports = { serveur, Client };
