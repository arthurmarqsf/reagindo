/* Reagindo — recorte de fundo rodando FORA da tela principal (não trava a interface nem a gravação).
   Worker clássico: a biblioteca usa importScripts (que não existe em worker "module"), e o pacote é carregado com import(). */
const V = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';
let seg = null, lastTs = 0;
const opts = (delegate, canvas) => ({ baseOptions: { modelAssetPath: MODEL, delegate }, canvas, runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true });

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      const { FilesetResolver, ImageSegmenter } = await import(V + '/vision_bundle.mjs');
      const fs = await FilesetResolver.forVisionTasks(V + '/wasm');
      try { seg = await ImageSegmenter.createFromOptions(fs, opts('GPU', typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : undefined)); }
      catch { seg = await ImageSegmenter.createFromOptions(fs, opts('CPU')); }
      self.postMessage({ type: 'ready' });
    } catch (err) { self.postMessage({ type: 'fail', msg: String(err && err.message || err) }); }
    return;
  }
  if (m.type === 'frame') {
    const bmp = m.bmp;
    if (!seg) { bmp.close(); return; }
    const t0 = performance.now(); let out = null;
    try {
      const ts = Math.max(lastTs + 1, m.ts); lastTs = ts;
      seg.segmentForVideo(bmp, ts, (res) => {
        const mk = res.confidenceMasks && res.confidenceMasks[0]; if (!mk) return;
        const f = mk.getAsFloat32Array(), a = new Uint8ClampedArray(f.length);
        for (let i = 0; i < f.length; i++) a[i] = f[i] * 255;
        out = { w: mk.width, h: mk.height, a };
      });
    } catch (err) { self.postMessage({ type: 'error', msg: String(err && err.message || err) }); }
    bmp.close();
    if (out) self.postMessage({ type: 'mask', w: out.w, h: out.h, a: out.a, cost: performance.now() - t0 }, [out.a.buffer]);
    else self.postMessage({ type: 'skip', cost: performance.now() - t0 });
  }
};
