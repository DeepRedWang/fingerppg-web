/* Camera and display adapter. All image processing is local; no upload endpoint. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const CAMERA_KEY = 'fingerppg.default-camera.v1';
  class WebPPG {
    constructor() {
      this.video = $('video'); this.canvas = $('wave'); this.ctx = this.canvas.getContext('2d');
      this.imageCanvas = document.createElement('canvas');
      this.imageContext = this.imageCanvas.getContext('2d', {willReadFrequently: true});
      this.rows = []; this.history = []; this.frames = []; this.arrivals = [];
      this.running = false; this.starting = false; this.token = 0; this.worker = null; this.stream = null;
      this.callbackId = null; this.timer = null; this.healthTimer = null; this.wakeLock = null;
      this.cameraId = '';
      try { this.cameraId = window.localStorage.getItem(CAMERA_KEY) || ''; } catch (_) {}
      this.mobileCamera = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '') ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      $('start').addEventListener('click', () => this.running || this.starting ? this.stop('已停止 · 可下载本次数据') : this.startCamera());
      $('demo').addEventListener('click', () => this.startDemo());
      $('export').addEventListener('click', () => this.exportData());
      document.addEventListener('visibilitychange', () => { if (document.hidden && (this.running || this.starting)) this.stop('已切到后台 · 采集停止'); });
      window.addEventListener('pagehide', () => this.stop('页面已离开 · 采集停止'));
      window.addEventListener('resize', () => this.resize());
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.resize()).observe(this.canvas);
      this.environment(); this.resize();
    }
    environment() {
      const note = $('environment-note');
      if (!window.isSecureContext) {
        note.textContent = '当前地址不是安全连接，浏览器不能开启相机。手机请使用 HTTPS 地址；电脑本机可打开 localhost。下方的演示模式仍可使用。';
        note.hidden = false; $('start').disabled = true;
      } else if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        note.textContent = '当前浏览器不支持摄像头采集。请在手机 Safari 或 Chrome 中打开；也可以先查看演示。';
        note.hidden = false; $('start').disabled = true;
      }
    }
    resize() {
      const box = this.canvas.getBoundingClientRect(), ratio = Math.min(window.devicePixelRatio || 1, 3);
      if (!box.width || !box.height) return;
      this.width = box.width; this.height = box.height;
      this.canvas.width = Math.round(box.width * ratio); this.canvas.height = Math.round(box.height * ratio);
      this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0); this.paint();
    }
    paint() { if (this.width) PPGView.drawWave(this.ctx, this.width, this.height, this.history, this.lastTime || 0); }
    setupSession(mode) {
      this.rows = []; this.frames = []; this.history = []; this.arrivals = [];
      this.lastTime = 0; this.lastTimestamp = null; this.lastFrameKey = null; this.lastUi = 0; this.lastPaint = 0;
      this.framesSeen = 0; this.framesSkipped = 0; this.presentedMissed = 0; this.busy = false; this.requestId = 0;
      this.mode = mode; this.origin = performance.now(); this.lastFrameWall = this.origin; this.receivedFrame = false;
      this.metadata = {version: 1, mode, started_at: new Date().toISOString(), backend: null, video_uploaded: false,
        requested_flash: false, requested_camera_fps: mode === 'camera' ? 60 : null, filter_fs_hz: 60,
        roi_fraction_xyxy: [.2,.2,.8,.8], bandpass_hz: [.5,5], warmup_s: 3,
        heart_rate_window_s: 8, heart_rate_minimum_initialized_s: 5, heart_rate_update_s: 1,
        timestamp_basis: mode === 'camera' ? 'performance.now() at video frame callback; relative seconds, not hardware exposure time.' : 'Synthetic 30 Hz signal times; paced demonstration, not camera measurements.'};
      $('bpm').textContent = '—'; $('fps').textContent = '—'; $('elapsed').textContent = '0.0'; $('red').textContent = '—';
      $('export').disabled = true; $('export-note').textContent = '采集后即可导出。';
      $('mode-pill').textContent = mode === 'demo' ? '演示 · 非实测' : '实时采集';
      $('mode-pill').className = 'mode-pill ' + (mode === 'demo' ? 'demo' : 'live');
      this.processor = null;
      try {
        this.worker = new Worker('worker.js');
        const token = this.token;
        this.worker.onmessage = event => {
          if (token !== this.token || !this.running) return;
          if (event.data.kind === 'error') { this.stop('计算失败：' + event.data.message); return; }
          this.busy = false; this.accept(event.data);
        };
        this.worker.onerror = () => { if (token === this.token) this.stop('计算模块加载失败，请刷新页面并检查部署文件'); };
        this.metadata.processing = 'Web Worker';
      } catch (_) {
        this.worker = null; this.processor = new FingerPPG.PrimaryStream(); this.metadata.processing = 'main-thread fallback';
      }
      this.paint();
    }
    setRunning() {
      this.running = true; this.starting = false;
      $('start').textContent = '停止采集'; $('start').disabled = false; $('demo').disabled = true;
      if (navigator.wakeLock && navigator.wakeLock.request) {
        const token = this.token;
        navigator.wakeLock.request('screen').then(lock => {
          if (token !== this.token || !this.running) lock.release().catch(() => {}); else this.wakeLock = lock;
        }).catch(() => {});
      }
    }
    async startCamera() {
      if (this.running || this.starting) return;
      if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { this.environment(); return; }
      const token = ++this.token;
      this.starting = true; $('start').textContent = '取消启动'; $('demo').disabled = true;
      $('status').textContent = '请求相机权限，请在浏览器提示中允许';
      const selection = this.cameraId;
      const constraints = {audio: false, video: {width: {ideal: 640}, height: {ideal: 480}, frameRate: {ideal: 60, max: 60},
        ...(selection ? {deviceId: {exact: selection}} : {facingMode: this.mobileCamera ? {exact: 'environment'} : {ideal: 'environment'}})}};
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (token !== this.token) { stream.getTracks().forEach(track => track.stop()); return; }
        this.stream = stream;
        const track = stream.getVideoTracks()[0];
        const capabilities = track.getCapabilities ? track.getCapabilities() : {};
        if (capabilities.torch) {
          try { await track.applyConstraints({advanced: [{torch: false}]}); } catch (_) {}
        }
        if (token !== this.token) { stream.getTracks().forEach(item => item.stop()); return; }
        const settings = track.getSettings ? track.getSettings() : {};
        if (settings.torch === true) throw new Error('无法关闭补光灯，请先关闭相机补光后重试');
        if (!settings.deviceId) throw new Error('当前浏览器无法锁定摄像头，请使用新版 Safari 或 Chrome');
        if (selection && settings.deviceId !== selection) throw new Error('摄像头与锁定设备不一致，采集已停止');
        if (this.mobileCamera && settings.facingMode && settings.facingMode !== 'environment')
          throw new Error('未获得默认后置摄像头，采集已停止');
        this.video.srcObject = stream; await this.video.play();
        if (token !== this.token) { stream.getTracks().forEach(item => item.stop()); return; }
        // Persist only a successfully opened camera, never a cancelled permission request.
        this.cameraId = settings.deviceId;
        try { window.localStorage.setItem(CAMERA_KEY, this.cameraId); } catch (_) {}
        $('camera-name').textContent = track.label || (this.mobileCamera ? '默认后置摄像头' : '系统默认摄像头');
        this.setupSession('camera'); this.setRunning();
        this.metadata.camera_settings = settings;
        this.metadata.camera_selection = 'fixed deviceId; no camera switching';
        this.metadata.frame_callback = typeof this.video.requestVideoFrameCallback === 'function' ? 'requestVideoFrameCallback' : 'decoded-frame counter + requestAnimationFrame';
        $('preview-empty').hidden = true; $('roi').hidden = false; $('camera-state').textContent = '采集中';
        $('status').textContent = '等待手指覆盖摄像头';
        track.addEventListener('ended', () => { if (token === this.token && this.running) this.stop('相机已中断，请重新开始'); });
        track.addEventListener('mute', () => { if (token === this.token && this.running) this.stop('相机暂时不可用，请重新开始'); });
        this.scheduleCamera(token);
        this.healthTimer = setInterval(() => {
          if (this.running && track.getSettings().deviceId !== this.cameraId) {
            this.stop('摄像头已发生变化，采集停止，请重新开始'); return;
          }
          if (this.running && performance.now() - this.lastFrameWall > (this.receivedFrame ? 2500 : 8000)) this.stop('未收到新的相机帧，请重新开始或更换浏览器');
        }, 500);
      } catch (error) {
        if (stream) stream.getTracks().forEach(track => track.stop());
        if (token !== this.token) return;
        const messages = {NotAllowedError: '未获得摄像头权限，请在浏览器网站设置中允许相机后重试',
          NotFoundError: selection ? '锁定的摄像头不可用。请检查相机权限；若已重置权限，请清除此网站保存的数据后重新打开' : '没有找到默认摄像头',
          NotReadableError: '默认摄像头被其他应用占用或暂时无法读取',
          OverconstrainedError: '默认摄像头不可用或不支持当前设置。请检查相机权限；若已重置权限，请清除此网站保存的数据后重新打开',
          AbortError: '相机启动已中断'};
        this.stop(messages[error.name] || error.message || '无法启动摄像头');
      }
    }
    scheduleCamera(token) {
      if (!this.running || token !== this.token) return;
      const callback = (now, metadata) => {
        this.callbackId = null;
        if (!this.running || token !== this.token) return;
        try {
          this.cameraFrame(metadata);
          this.scheduleCamera(token);
        } catch (error) { this.stop(error.message || '读取相机帧失败'); }
      };
      if (typeof this.video.requestVideoFrameCallback === 'function') {
        this.callbackType = 'video'; this.callbackId = this.video.requestVideoFrameCallback(callback);
      } else {
        this.callbackType = 'animation'; this.callbackId = requestAnimationFrame(now => callback(now, null));
      }
    }
    cameraFrame(metadata) {
      if (this.video.readyState < 2 || !this.video.videoWidth || !this.video.videoHeight) return;
      let key;
      if (metadata) key = metadata.presentedFrames;
      else {
        const quality = this.video.getVideoPlaybackQuality ? this.video.getVideoPlaybackQuality() : null;
        key = quality ? quality.totalVideoFrames : this.video.webkitDecodedFrameCount;
        if (!Number.isFinite(key)) throw new Error('当前浏览器无法区分新视频帧，请使用新版 Safari 或 Chrome');
      }
      if (key === this.lastFrameKey) return;
      if (this.lastFrameKey !== null && key > this.lastFrameKey + 1) this.presentedMissed += key - this.lastFrameKey - 1;
      this.lastFrameKey = key; this.framesSeen++;
      const now = performance.now(), t = (now - this.origin) / 1000;
      this.receivedFrame = true; this.lastFrameWall = now;
      if (this.busy) { this.framesSkipped++; return; }
      const w = this.video.videoWidth, h = this.video.videoHeight;
      if (this.imageCanvas.width !== w || this.imageCanvas.height !== h) {
        this.imageCanvas.width = w; this.imageCanvas.height = h;
        $('preview-box').style.aspectRatio = `${w} / ${h}`;
        // Match preview and source aspect ratio, including portrait camera streams.
        $('preview-box').style.maxHeight = 'none';
      }
      this.imageContext.drawImage(this.video, 0, 0, w, h);
      const pixels = this.imageContext.getImageData(0, 0, w, h).data;
      const rgb = PPGView.rgbMean(pixels, w, h);
      this.submit(t, rgb, {media_time_s: metadata ? metadata.mediaTime : this.video.currentTime,
        presented_frames: key, width: w, height: h});
    }
    submit(t, rgb, frame = {}) {
      if (!this.running || (this.lastTimestamp !== null && t <= this.lastTimestamp)) return;
      this.lastTimestamp = t;
      const input = {id: ++this.requestId, t, rgb, frame};
      if (this.worker) { this.busy = true; this.worker.postMessage(input); }
      else {
        const start = performance.now(), rows = this.processor.feed(t, rgb[0], rgb[1]);
        this.accept({...input, rows, processing_ms: performance.now() - start});
      }
    }
    accept(result) {
      const {t, rgb, frame, rows} = result;
      this.rows.push(...rows); this.history.push(...rows); this.lastTime = t;
      this.frames.push({time_s: t, red: rgb[0], green: rgb[1], blue: rgb[2],
        media_time_s: frame.media_time_s ?? null, presented_frames: frame.presented_frames ?? null,
        width: frame.width ?? null, height: frame.height ?? null, processing_ms: result.processing_ms});
      this.arrivals.push(t); if (this.arrivals.length > 120) this.arrivals.shift();
      while (this.history.length && this.history[0].time_s < t - 12) this.history.shift();
      const now = performance.now();
      if (now - this.lastPaint >= 40) { this.paint(); this.lastPaint = now; }
      if (now - this.lastUi >= 200) { this.updateReadout(rgb); this.lastUi = now; }
      if (t >= 300) this.stop('已完成 5 分钟采集，请下载数据');
    }
    updateReadout(rgb) {
      const row = this.rows[this.rows.length - 1], n = this.arrivals.length;
      const rate = n > 1 ? (n - 1) / (this.arrivals[n - 1] - this.arrivals[0]) : 0;
      $('bpm').textContent = row && row.heart_rate_bpm !== null ? row.heart_rate_bpm.toFixed(0) : '—';
      $('status').textContent = PPGView.statusText(row);
      $('fps').textContent = rate.toFixed(1); $('elapsed').textContent = this.lastTime.toFixed(1);
      $('red').textContent = rgb[0].toFixed(1); $('export').disabled = this.rows.length === 0;
      $('export-note').textContent = this.mode === 'demo' ? '演示数据，文件名带 DEMO 标记。' : '数据保存在当前页面，请在关闭前下载。';
    }
    startDemo() {
      if (this.running || this.starting) return;
      ++this.token; this.setupSession('demo'); this.setRunning();
      $('status').textContent = '演示数据 · 估计中'; $('camera-state').textContent = '演示模式';
      $('preview-empty').hidden = false; $('preview-empty').lastElementChild.textContent = '演示模式未使用摄像头';
      let index = 0;
      this.timer = setInterval(() => {
        if (!this.running || this.busy) return;
        const elapsed = (performance.now() - this.origin) / 1000;
        if (index / 30 <= elapsed) {
          const t = index++ / 30, red = 50 * Math.exp(-.01 * Math.sin(2 * Math.PI * 1.2 * t));
          this.framesSeen++; this.submit(t, [red, 10, 4]);
        }
      }, 8);
    }
    stop(message = '已停止') {
      this.running = false; this.starting = false; ++this.token;
      if (this.callbackId !== null) {
        if (this.callbackType === 'video' && this.video.cancelVideoFrameCallback) this.video.cancelVideoFrameCallback(this.callbackId);
        else cancelAnimationFrame(this.callbackId);
        this.callbackId = null;
      }
      if (this.timer) clearInterval(this.timer); this.timer = null;
      if (this.healthTimer) clearInterval(this.healthTimer); this.healthTimer = null;
      if (this.worker) this.worker.terminate(); this.worker = null;
      if (this.busy) this.framesSkipped++; this.busy = false;
      if (this.stream) this.stream.getTracks().forEach(track => track.stop()); this.stream = null;
      this.video.pause(); this.video.srcObject = null;
      if (this.wakeLock) this.wakeLock.release().catch(() => {}); this.wakeLock = null;
      if (this.metadata) this.metadata.stopped_at = new Date().toISOString();
      $('start').textContent = '开始采集'; $('demo').disabled = false;
      $('bpm').textContent = '—'; $('status').textContent = message; $('camera-state').textContent = '未开启';
      $('roi').hidden = true; $('preview-empty').hidden = false;
      $('preview-empty').lastElementChild.textContent = '开始后显示相机预览';
      $('mode-pill').textContent = this.mode === 'demo' ? '演示 · 已停止' : '已停止';
      $('mode-pill').className = 'mode-pill' + (this.mode === 'demo' ? ' demo' : '');
      $('export').disabled = this.rows.length === 0; this.paint(); this.environment();
    }
    exportData() {
      if (!this.rows.length) return;
      if (this.running || this.starting) this.stop('已停止 · 正在导出本次数据');
      const type = $('export-type').value;
      let content, extension, mime;
      if (type === 'metadata') {
        content = JSON.stringify({...this.metadata, exported_at: new Date().toISOString(),
          frames_received: this.framesSeen, processed_frames: this.frames.length, application_skipped_frames: this.framesSkipped,
          missed_presented_frames: this.presentedMissed, waveform_rows: this.rows.length}, null, 2);
        extension = '.json'; mime = 'application/json';
      } else {
        content = PPGView.csv(type === 'frames' ? this.frames : this.rows);
        extension = type === 'frames' ? '_frames.csv' : '.csv'; mime = 'text/csv;charset=utf-8';
      }
      const name = `fingerppg_${this.mode === 'demo' ? 'DEMO_' : ''}${this.metadata.started_at.replace(/[:.]/g, '-')}${extension}`;
      const url = URL.createObjectURL(new Blob([content], {type: mime}));
      const link = document.createElement('a'); link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      $('status').textContent = '已停止 · 已发起下载';
      $('export-note').textContent = '已发起下载。手机请在浏览器下载列表或“文件”中查看。';
    }
  }
  // Expose the adapter class for deterministic tests; no capture starts on load.
  window.WebPPG = WebPPG;
  window.ppgApp = new WebPPG();
})();
