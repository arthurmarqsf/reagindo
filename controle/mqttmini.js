// Cliente MQTT 3.1.1 minimo sobre WebSocket (sem dependencias). QoS 0.
// new MQTTMini(url, clientId, onMessage(topic, text), onStatus(ok)) -> .sub(topic) .pub(topic, text, retain)
(function () {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const str = s => { const b = enc.encode(s); return [b.length >> 8, b.length & 255, ...b]; };
  const len = n => { const o = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; o.push(d); } while (n > 0); return o; };
  function pacote(tipo, corpo) { return new Uint8Array([tipo, ...len(corpo.length), ...corpo]); }

  window.MQTTMini = function (url, clientId, onMsg, onStatus) {
    let ws, buf = new Uint8Array(0), pid = 1, ping, subs = new Set(), self = this, parado = false;
    this.ok = false; this.url = url;
    function conectar() {
      if (parado) return;
      try { ws = new WebSocket(url, 'mqtt'); } catch (e) { setTimeout(conectar, 3000); return; }
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        const corpo = [...str('MQTT'), 4, 0x02, 0, 30, ...str(clientId)];
        ws.send(pacote(0x10, corpo));
      };
      ws.onmessage = ev => {
        const novo = new Uint8Array(ev.data), b = new Uint8Array(buf.length + novo.length);
        b.set(buf); b.set(novo, buf.length); buf = b;
        while (buf.length >= 2) {
          let mult = 1, rl = 0, i = 1, d;
          do { if (i >= buf.length) return; d = buf[i++]; rl += (d & 127) * mult; mult *= 128; } while (d & 128);
          if (buf.length < i + rl) return;
          const tipo = buf[0], p = buf.slice(i, i + rl); buf = buf.slice(i + rl);
          if ((tipo & 0xF0) === 0x20) { // CONNACK
            if (p[1] === 0) { self.ok = true; onStatus && onStatus(true); subs.forEach(t => enviarSub(t));
              clearInterval(ping); ping = setInterval(() => { try { ws.send(new Uint8Array([0xC0, 0])); } catch (e) {} }, 20000); }
          } else if ((tipo & 0xF0) === 0x30) { // PUBLISH
            const tl = (p[0] << 8) | p[1], topic = dec.decode(p.slice(2, 2 + tl));
            let off = 2 + tl; if (tipo & 0x06) off += 2;
            onMsg && onMsg(topic, dec.decode(p.slice(off)));
          }
        }
      };
      ws.onclose = () => { const era = self.ok; self.ok = false; clearInterval(ping); buf = new Uint8Array(0); if (era) onStatus && onStatus(false); setTimeout(conectar, 3000); };
      ws.onerror = () => { try { ws.close(); } catch (e) {} };
    }
    function enviarSub(t) { const id = pid++ & 0xFFFF || 1; ws.send(pacote(0x82, [id >> 8, id & 255, ...str(t), 0])); }
    this.sub = t => { subs.add(t); if (self.ok) enviarSub(t); };
    this.pub = (t, texto, reter) => { if (!self.ok) return false; ws.send(pacote(0x30 | (reter ? 1 : 0), [...str(t), ...enc.encode(texto)])); return true; };
    this.fechar = () => { parado = true; try { ws.close(); } catch (e) {} };
    conectar();
  };
  window.RELAY_BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
})();
