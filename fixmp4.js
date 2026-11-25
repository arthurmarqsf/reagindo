/* Reagindo — converte o MP4 "fragmentado" do MediaRecorder num MP4 padrão (moov + mdat único).
   O iPhone só oferece "Salvar Vídeo" (app Fotos) pra MP4 padrão. Não recodifica: só reorganiza
   as caixas e copia os bytes do vídeo, então é rápido e usa pouca memória. */
'use strict';
(function () {
  const td = (u8, p) => String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
  const dvOf = (u8) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  async function rd(blob, a, b) { return new Uint8Array(await blob.slice(a, b).arrayBuffer()); }
  function kids(u8, s, e) {
    const dv = dvOf(u8), out = []; let p = s;
    while (p + 8 <= e) {
      let size = dv.getUint32(p), hdr = 8; const type = td(u8, p + 4);
      if (size === 1) { size = Number(dv.getBigUint64(p + 8)); hdr = 16; } else if (size === 0) size = e - p;
      if (size < hdr || p + size > e) break;
      out.push({ type, s: p, size, hdr }); p += size;
    }
    return out;
  }
  const inner = (u8, b) => kids(u8, b.s + b.hdr, b.s + b.size);
  const find = (u8, b, t) => inner(u8, b).find((x) => x.type === t);
  const raw = (u8, b) => u8.slice(b.s, b.s + b.size);

  // ---- escrita ----
  function cat(parts) { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; }
  function box(type, ...parts) {
    const body = cat(parts.filter(Boolean)), o = new Uint8Array(8 + body.length), dv = dvOf(o);
    dv.setUint32(0, o.length); for (let i = 0; i < 4; i++) o[4 + i] = type.charCodeAt(i); o.set(body, 8); return o;
  }
  function u32s(arr) { const o = new Uint8Array(arr.length * 4), dv = dvOf(o); arr.forEach((v, i) => dv.setUint32(i * 4, v >>> 0)); return o; }
  function full(type, ver, flags, body) { const h = new Uint8Array(4); h[0] = ver; h[1] = (flags >> 16) & 255; h[2] = (flags >> 8) & 255; h[3] = flags & 255; return box(type, h, body); }
  function setDur(rawBox, offV0, offV1, dur) { // muda o campo "duration" de mvhd/tkhd/mdhd
    const b = rawBox.slice(), dv = dvOf(b), ver = b[8];
    if (ver === 1) dv.setBigUint64(8 + offV1, BigInt(Math.round(dur))); else dv.setUint32(8 + offV0, Math.min(0xffffffff, Math.round(dur)));
    return b;
  }

  async function defrag(blob) {
    const N = blob.size, top = [];
    for (let off = 0; off + 8 <= N;) {
      const h = await rd(blob, off, Math.min(N, off + 16)), dv = dvOf(h);
      let size = dv.getUint32(0), hdr = 8; const type = td(h, 4);
      if (size === 1) { size = Number(dv.getBigUint64(8)); hdr = 16; } else if (size === 0) size = N - off;
      if (size < 8) break;
      top.push({ type, off, size, hdr }); off += size;
    }
    const moovT = top.find((b) => b.type === 'moov');
    if (!moovT || !top.some((b) => b.type === 'moof')) return null; // já é MP4 normal
    const mv = await rd(blob, moovT.off, moovT.off + moovT.size), mvBox = { s: 0, size: mv.length, hdr: moovT.hdr };
    const mvhd = find(mv, mvBox, 'mvhd'), mvDv = dvOf(mv);
    const movieTS = mv[mvhd.s + 8] === 1 ? mvDv.getUint32(mvhd.s + 8 + 20) : mvDv.getUint32(mvhd.s + 8 + 12);
    const trex = {}; const mvex = find(mv, mvBox, 'mvex');
    if (mvex) for (const t of inner(mv, mvex).filter((x) => x.type === 'trex')) {
      const p = t.s + 12; trex[mvDv.getUint32(p)] = { dur: mvDv.getUint32(p + 8), size: mvDv.getUint32(p + 12), flags: mvDv.getUint32(p + 16) };
    }
    const tracks = {};
    for (const tk of inner(mv, mvBox).filter((x) => x.type === 'trak')) {
      const tkhd = find(mv, tk, 'tkhd'), id = mvDv.getUint32(tkhd.s + 8 + (mv[tkhd.s + 8] === 1 ? 20 : 12));
      const mdia = find(mv, tk, 'mdia'), mdhd = find(mv, mdia, 'mdhd'), hdlr = find(mv, mdia, 'hdlr');
      const ts = mv[mdhd.s + 8] === 1 ? mvDv.getUint32(mdhd.s + 8 + 20) : mvDv.getUint32(mdhd.s + 8 + 12);
      const minf = find(mv, mdia, 'minf'), stbl = find(mv, minf, 'stbl');
      tracks[id] = { id, ts, kind: td(mv, hdlr.s + 16), tkhd: raw(mv, tkhd), mdhd: raw(mv, mdhd), hdlr: raw(mv, hdlr),
        edts: find(mv, tk, 'edts') && raw(mv, find(mv, tk, 'edts')),
        mh: inner(mv, minf).filter((x) => x.type === 'vmhd' || x.type === 'smhd' || x.type === 'dinf').map((x) => raw(mv, x)),
        stsd: raw(mv, find(mv, stbl, 'stsd')), dur: [], size: [], sync: [], cts: [], chunks: [] };
    }
    // lê os fragmentos (moof) — só os cabeçalhos; os dados (mdat) ficam no arquivo original
    for (const mf of top.filter((b) => b.type === 'moof')) {
      const m = await rd(blob, mf.off, mf.off + mf.size), dv = dvOf(m), mb = { s: 0, size: m.length, hdr: mf.hdr };
      for (const tf of inner(m, mb).filter((x) => x.type === 'traf')) {
        const tfhd = find(m, tf, 'tfhd'); let p = tfhd.s + 8; const fl = dv.getUint32(p) & 0xffffff, id = dv.getUint32(p + 4); p += 8;
        const T = tracks[id]; if (!T) continue; const dflt = trex[id] || { dur: 0, size: 0, flags: 0 };
        let base = mf.off, dDur = dflt.dur, dSize = dflt.size, dFlags = dflt.flags;
        if (fl & 1) { base = Number(dv.getBigUint64(p)); p += 8; }
        if (fl & 2) p += 4;
        if (fl & 8) { dDur = dv.getUint32(p); p += 4; }
        if (fl & 0x10) { dSize = dv.getUint32(p); p += 4; }
        if (fl & 0x20) { dFlags = dv.getUint32(p); p += 4; }
        let next = base;
        for (const tr of inner(m, tf).filter((x) => x.type === 'trun')) {
          let q = tr.s + 8; const ver = m[q], f = dv.getUint32(q) & 0xffffff, n = dv.getUint32(q + 4); q += 8;
          let start = next; if (f & 1) { start = base + dv.getInt32(q); q += 4; }
          let firstFlags = null; if (f & 4) { firstFlags = dv.getUint32(q); q += 4; }
          let bytes = 0;
          for (let i = 0; i < n; i++) {
            const d = f & 0x100 ? dv.getUint32((q += 4) - 4) : dDur;
            const sz = f & 0x200 ? dv.getUint32((q += 4) - 4) : dSize;
            let sf = f & 0x400 ? dv.getUint32((q += 4) - 4) : dFlags; if (i === 0 && firstFlags !== null) sf = firstFlags;
            const c = f & 0x800 ? (ver ? dv.getInt32((q += 4) - 4) : dv.getUint32((q += 4) - 4)) : 0;
            T.dur.push(d); T.size.push(sz); T.sync.push(!(sf & 0x10000)); T.cts.push(c); bytes += sz;
          }
          if (n) T.chunks.push({ src: start, n, bytes }); next = start + bytes;
        }
      }
    }
    const list = Object.values(tracks).filter((t) => t.size.length);
    if (!list.length) return null;
    // ordem dos pedaços = ordem no arquivo original (mantém áudio e vídeo intercalados)
    const all = []; list.forEach((t) => t.chunks.forEach((c) => all.push(Object.assign(c, { t }))));
    all.sort((a, b) => a.src - b.src);

    const rle = (arr) => { const o = []; for (const v of arr) { const l = o[o.length - 1]; if (l && l[1] === v) l[0]++; else o.push([1, v]); } return o; };
    function buildMoov(base) {
      let pos = base; for (const c of all) { c.out = pos; pos += c.bytes; }
      let maxDur = 0;
      const traks = list.map((t) => {
        const mediaDur = t.dur.reduce((a, b) => a + b, 0), movDur = mediaDur / t.ts * movieTS; maxDur = Math.max(maxDur, movDur);
        const stts = full('stts', 0, 0, cat([u32s([rle(t.dur).length]), ...rle(t.dur).map(([c, v]) => u32s([c, v]))]));
        const hasCts = t.cts.some((v) => v !== 0), neg = t.cts.some((v) => v < 0);
        const ctts = hasCts ? full('ctts', neg ? 1 : 0, 0, cat([u32s([rle(t.cts).length]), ...rle(t.cts).map(([c, v]) => u32s([c, v]))])) : null;
        const per = t.chunks.map((c) => c.n), stscE = []; per.forEach((n, i) => { if (!stscE.length || stscE[stscE.length - 1][1] !== n) stscE.push([i + 1, n, 1]); });
        const stsc = full('stsc', 0, 0, cat([u32s([stscE.length]), ...stscE.map((e) => u32s(e))]));
        const stsz = full('stsz', 0, 0, cat([u32s([0, t.size.length]), u32s(t.size)]));
        const co = new Uint8Array(4 + t.chunks.length * 8), cdv = dvOf(co); cdv.setUint32(0, t.chunks.length);
        t.chunks.forEach((c, i) => cdv.setBigUint64(4 + i * 8, BigInt(c.out)));
        const co64 = full('co64', 0, 0, co);
        const syncIdx = []; t.sync.forEach((s, i) => { if (s) syncIdx.push(i + 1); });
        const stss = t.kind === 'vide' && syncIdx.length < t.sync.length ? full('stss', 0, 0, cat([u32s([syncIdx.length]), u32s(syncIdx)])) : null;
        const stbl = box('stbl', t.stsd, stts, ctts, stsc, stsz, co64, stss);
        const minf = box('minf', ...t.mh, stbl);
        const mdia = box('mdia', setDur(t.mdhd, 16, 24, mediaDur), t.hdlr, minf);
        return box('trak', setDur(t.tkhd, 20, 28, movDur), t.edts, mdia);
      });
      return box('moov', setDur(raw(mv, mvhd), 16, 24, maxDur), ...traks);
    }
    const ftyp = box('ftyp', new Uint8Array([105, 115, 111, 109, 0, 0, 2, 0]), new TextEncoder().encode('isomiso2avc1mp41'));
    const total = all.reduce((a, c) => a + c.bytes, 0), big = total + 16 > 0xffffffff;
    const mdatHdr = new Uint8Array(big ? 16 : 8), hdv = dvOf(mdatHdr);
    if (big) { hdv.setUint32(0, 1); hdv.setBigUint64(8, BigInt(total + 16)); } else hdv.setUint32(0, total + 8);
    mdatHdr.set([109, 100, 97, 116], 4);
    let moov = buildMoov(0); moov = buildMoov(ftyp.length + moov.length + mdatHdr.length);
    const parts = [ftyp, moov, mdatHdr]; for (const c of all) parts.push(blob.slice(c.src, c.src + c.bytes));
    return new Blob(parts, { type: 'video/mp4' });
  }

  // devolve um MP4 padrão (ou o original, se não precisar/conseguir)
  window.fixMp4 = async function (blob) {
    if (!blob || !/mp4/.test(blob.type || '')) return blob;
    try { const out = await defrag(blob); return out || blob; } catch (e) { console.warn('fixMp4', e); return blob; }
  };
})();
