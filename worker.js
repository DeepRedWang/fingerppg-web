'use strict';
importScripts('ppg-core.js?v=9-green', 'spectral-motion.js?v=10');
let pipeline;
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
    if(!pipeline)pipeline=new FingerSpectral.Pipeline(!!event.data.spectral);
    const result=pipeline.feed(t,rgb,event.data.imu||[]);
    self.postMessage({kind: 'result', id, t, rgb, frame, ...result, processing_ms: performance.now() - start});
  } catch (error) { self.postMessage({kind: 'error', message: error.message}); }
};
