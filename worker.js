'use strict';
importScripts('ppg-core.js');
const processor = new FingerPPG.PrimaryStream();
self.onmessage = event => {
  const {id, t, rgb, frame} = event.data;
  try {
    const start = performance.now(), rows = processor.feed(t, rgb[0], rgb[1]);
    self.postMessage({kind: 'result', id, t, rgb, frame, rows, processing_ms: performance.now() - start});
  } catch (error) { self.postMessage({kind: 'error', message: error.message}); }
};
