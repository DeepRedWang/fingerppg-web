'use strict';
importScripts('ppg-core.js?v=5');
const processor = new FingerPPG.PrimaryStream();
const hrvTracker = new FingerPPG.HRVTracker();
self.onmessage = event => {
  const {id, t, frame, pixels} = event.data;
  let {rgb} = event.data;
  try {
    const start = performance.now();
    if (pixels) {
      rgb = [0,0,0];
      for (let i=0;i<pixels.length;i+=4) { rgb[0]+=pixels[i]; rgb[1]+=pixels[i+1]; rgb[2]+=pixels[i+2]; }
      rgb = rgb.map(value=>value/(pixels.length/4));
    }
    const rows = processor.feed(t, rgb[0], rgb[1]);
    const hrv = rows.map(row=>hrvTracker.feed(row)).filter(Boolean);
    self.postMessage({kind: 'result', id, t, rgb, frame, rows, hrv, processing_ms: performance.now() - start});
  } catch (error) { self.postMessage({kind: 'error', message: error.message}); }
};
