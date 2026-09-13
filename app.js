/* Camera and display adapter. All image processing is local; no upload endpoint. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  // v1 could pin a virtual multi-lens camera. Deliberately reselect once after upgrade.
  const CAMERA_KEY = 'fingerppg.single-camera.v2';
  const MOTION_FIELDS = ['accel_x_m_s2', 'accel_y_m_s2', 'accel_z_m_s2'];
  const finite = value => Number.isFinite(value) ? value : null;
  function physicalRearScore(label) {
    const name = (label || '').trim().toLowerCase();
    if (/front|user|前|dual|triple|virtual|fusion|双|雙|三摄|三攝|三重|组合|組合|虚拟|虛擬/.test(name)) return 0;
    if (!/back|rear|environment|后|後|背|rück/.test(name)) return 0;
    if (/ultra|超广|超廣|tele|长焦|長焦/.test(name)) return 1;
    if (/wide|广角|廣角|主摄|主攝/.test(name)) return 3;
    return /^(back camera|rear camera|后置摄像头|后置相机|后置相機|後置相機|後置攝影機|背面相机|背面相機|rückkamera)$/.test(name) ? 2 : 0;
  }
  class MotionCapture {
    constructor() {
      this.rows = []; this.history = []; this.active = false;
      this.state = 'idle'; this.message = '点击开始后申请运动权限，与 PPG 一起记录。';
    }
    static permission(enabled) {
      if (!enabled) return Promise.resolve('disabled');
      if (!window.isSecureContext) return Promise.resolve('insecure');
      if (typeof window.DeviceMotionEvent === 'undefined') return Promise.resolve('unsupported');
      try {
        // Called synchronously by the Start click, before awaiting camera access.
        if (typeof window.DeviceMotionEvent.requestPermission === 'function')
          return Promise.resolve(window.DeviceMotionEvent.requestPermission()).then(
            result => result === 'granted' ? 'granted' : 'denied', () => 'denied');
        return Promise.resolve('not-required');
      } catch (_) { return Promise.resolve('denied'); }
    }
    reset(mode, origin, enabled) {
      this.stop(); this.rows = []; this.history = []; this.mode = mode; this.origin = origin;
      this.enabled = enabled; this.permission = enabled ? 'pending' : 'disabled';
      this.nullEvents = 0; this.validEvents = 0; this.lastValid = null; this.lastEvent = null; this.lastTime = 0;
      this.restarts = 0; this.consecutiveRestarts = 0; this.lastRestart = origin; this.gaps = [];
      this.state = enabled ? 'waiting' : 'disabled';
      this.message = enabled ? '等待运动权限与传感器数据…' : '本次未启用 IMU';
      this.render();
    }
    start(permission) {
      this.permission = permission;
      const failures = {disabled: '本次未启用 IMU', insecure: 'IMU 需要 HTTPS 安全连接',
        unsupported: '此浏览器不支持运动传感器，PPG 可继续采集',
        denied: '未获得运动权限，PPG 可继续采集；请检查网站权限后重新开始'};
      if (failures[permission]) { this.state = permission; this.message = failures[permission]; this.render(); return; }
      this.active = true; this.state = 'waiting'; this.startedWall = performance.now();
      this.message = this.mode === 'demo' ? '合成运动信号 · 未访问手机 IMU' : '等待手机运动数据…';
      if (this.mode !== 'demo') {
        this.listener = event => this.record(event, performance.now());
        window.addEventListener('devicemotion', this.listener);
      }
      this.render();
    }
    record(event, now) {
      if (!this.active) return;
      const row = {time_s: (now - this.origin) / 1000, callback_performance_ms: now,
        event_timestamp_ms: finite(event.timeStamp), reported_interval_ms: finite(event.interval),
        accel_x_m_s2: finite(event.accelerationIncludingGravity?.x), accel_y_m_s2: finite(event.accelerationIncludingGravity?.y), accel_z_m_s2: finite(event.accelerationIncludingGravity?.z)};
      row.has_sensor_value = MOTION_FIELDS.some(key => row[key] !== null);
      if (this.lastEvent !== null && now - this.lastEvent > 250)
        this.gaps.push({start_s: (this.lastEvent-this.origin)/1000, end_s: row.time_s, duration_ms: now-this.lastEvent});
      this.rows.push(row); this.lastTime = row.time_s; this.lastEvent = now;
      if (row.has_sensor_value) { this.validEvents++; this.lastValid = now; this.state = 'receiving'; this.consecutiveRestarts = 0; }
      else this.nullEvents++;
      // Bound memory even if a device emits unusually fast motion events.
      if (this.rows.length >= 120000) {
        this.stop(); this.state = 'limit'; this.message = '加速度已达 120,000 条上限并停止；PPG 继续，可导出数据';
      }
    }
    tick() {
      if (!this.active) return;
      const now = performance.now(); this.lastTime = (now - this.origin) / 1000;
      if (this.mode === 'demo') {
        // 50 Hz synthetic timestamps, independent of browser timer jitter.
        const end = Math.min(this.lastTime, 300);
        while (this.active && this.demoIndex / 50 <= end) {
          const t = this.demoIndex++ / 50, s = Math.sin(2 * Math.PI * 1.2 * t), c = Math.cos(2 * Math.PI * 1.2 * t);
          this.record({timeStamp: null, interval: 20,
            accelerationIncludingGravity: {x: .12*s, y: .08*c, z: 9.81+.2*s}}, this.origin + t * 1000);
        }
      } else if (now - (this.lastValid ?? this.startedWall) > 3000) {
        this.state = 'no-data'; this.message = this.validEvents ? '等待加速度恢复 · 会话继续，缺口如实记录' :
          '未收到有效加速度；请检查运动权限或在手机 Safari 中打开，PPG 可继续';
        // Only reattach after an actual absence of events, never for a stationary phone.
        if (now - (this.lastEvent ?? this.startedWall) > 5000 && now-this.lastRestart > 10000 && this.consecutiveRestarts < 3) {
          window.removeEventListener('devicemotion', this.listener);
          window.addEventListener('devicemotion', this.listener);
          this.restarts++; this.consecutiveRestarts++; this.lastRestart = now;
        }
      }
      if (this.state === 'receiving') this.message = this.mode === 'demo' ? '合成运动信号 · 非实测' : '正在接收手机 IMU 数据';
      this.render();
    }
    stop() {
      if (this.listener) window.removeEventListener('devicemotion', this.listener);
      this.listener = null;
      if (this.active) { this.state = 'stopped'; this.message = '加速度已停止，可导出本次记录'; }
      this.active = false;
    }
    stats(rows) {
      const valid = rows.filter(row => row.has_sensor_value);
      const deltas = valid.slice(1).map((row, i) => row.callback_performance_ms - valid[i].callback_performance_ms);
      const n = deltas.length, mean = n ? deltas.reduce((sum, value) => sum + value, 0) / n : null;
      return {events: rows.length, valid_events: valid.length, rate_hz: mean > 0 ? 1000 / mean : null,
        interval_mean_ms: mean, interval_std_ms: n ? Math.sqrt(deltas.reduce((sum, value) => sum + (value-mean)**2, 0) / n) : null,
        interval_max_ms: n ? deltas.reduce((max, value) => Math.max(max, value), 0) : null};
    }
    summary() {
      return {enabled: this.enabled, permission: this.permission, status: this.state, mode: this.mode,
        ...this.stats(this.rows), null_events: this.nullEvents, max_events: 120000,
        source: 'DeviceMotionEvent.accelerationIncludingGravity', includes_gravity: true,
        listener_restarts: this.restarts, gaps_over_250ms: this.gaps,
        fields_with_values: Object.fromEntries(MOTION_FIELDS.map(key => [key, this.rows.reduce((n, row) => n + (row[key] !== null ? 1 : 0), 0)])),
        timestamp_basis: this.mode === 'demo' ? 'Synthetic 50 Hz signal times; event_timestamp_ms is null.' :
          'time_s = (callback_performance_ms - session_origin_performance_ms) / 1000. event_timestamp_ms is the unmodified browser Event.timeStamp, not a hardware sample timestamp.',
        reported_interval_basis: 'DeviceMotionEvent.interval as provided by the browser; may differ from observed callback intervals.',
        signal_processing: 'Only three accelerationIncludingGravity axes, m/s^2. No gyroscope or fused linear acceleration fields are read or stored. No resampling or gap filling; missing axes remain null. Not hardware-synchronized.'};
    }
    render() {
      $('imu-mode').textContent = this.mode === 'demo' ? '演示 · 非实测' : this.active ? '已启用' : '未采集';
      $('imu-status').textContent = this.message;
      let first = this.rows.length;
      while (first && this.rows[first-1].time_s >= this.lastTime-12) first--;
      this.history = this.rows.slice(first);
      const recent = this.history.filter(row => row.time_s >= this.lastTime - 5), stats = this.stats(recent);
      this.displayGap = Math.max(.1, Math.min(.5, (stats.interval_mean_ms || 20)*3/1000));
      const fmt = value => value === null || !Number.isFinite(value) ? '—' : value.toFixed(1);
      $('imu-rate').textContent = fmt(stats.rate_hz); $('imu-interval').textContent = fmt(stats.interval_mean_ms);
      $('imu-jitter').textContent = fmt(stats.interval_std_ms);
      const last = this.rows[this.rows.length - 1];
      $('imu-timing').textContent = `最近 5 秒 · 最大间隔 ${fmt(stats.interval_max_ms)} ms · 浏览器报告 ${fmt(last?.reported_interval_ms)} ms · 已记录 ${this.rows.length} 条`;
      const keys = MOTION_FIELDS;
      $('imu-accel-values').textContent = keys.map(key => last && last[key] !== null ? last[key].toFixed(2) : '—').join(' / ');
      if (this.visible !== false) this.draw($('imu-accel'), keys);
    }
    draw(canvas, keys) {
      const box = this.box || canvas.getBoundingClientRect(), ratio = Math.min(window.devicePixelRatio || 1, 2);
      this.box = box;
      if (!box.width || !box.height) return;
      const w = box.width, h = box.height, pw = Math.round(w*ratio), ph = Math.round(h*ratio);
      if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
      const ctx = canvas.getContext('2d'); ctx.setTransform(ratio,0,0,ratio,0,0); ctx.clearRect(0,0,w,h);
      const end = Math.max(10, this.lastTime || 0), start = end-10;
      const rows = this.history.filter(row => row.time_s >= start && row.time_s <= end);
      const left=48, right=w-12, lane=(h-24)/3;
      ctx.font='10px sans-serif'; ctx.fillStyle='#9db1c3';
      ctx.fillText(`${start.toFixed(0)} s`,left,h-6); ctx.fillText(`${end.toFixed(0)} s`,right-28,h-6);
      const gap = this.displayGap;
      keys.forEach((key,index) => {
        let lo=Infinity, hi=-Infinity;
        rows.forEach(row=>{if(row[key]!==null){lo=Math.min(lo,row[key]);hi=Math.max(hi,row[key]);}});
        const hasData=Number.isFinite(lo), pad=hasData ? Math.max(.005,(hi-lo)*.15) : 1;
        lo=hasData ? lo-pad : -1; hi=hasData ? hi+pad : 1;
        const top=index*lane+14, bottom=(index+1)*lane-10, y=value=>bottom-(value-lo)/(hi-lo)*(bottom-top);
        ctx.lineWidth=1; ctx.strokeStyle='#254056'; ctx.fillStyle='#9db1c3';
        ctx.fillText(['X','Y','Z'][index],2,top-2);
        [lo,hi].forEach(value=>{
          const yy=y(value);ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(right,yy);ctx.stroke();
          ctx.fillText(Math.abs(value)>=100 ? value.toFixed(0) : value.toFixed(2),2,yy+9);
        });
        if(!hasData){ctx.fillText('暂无该轴数据',left+12,top+22);return;}
        ctx.strokeStyle=['#83e9ca','#80baff','#f4be80'][index]; ctx.lineWidth=1.4; ctx.beginPath(); let prev=null;
        rows.forEach(row => {
          if (row[key] === null) { prev=null; return; }
          const xx=left+(row.time_s-start)/10*(right-left), yy=y(row[key]);
          if (prev === null || row.time_s-prev > gap) ctx.moveTo(xx,yy); else ctx.lineTo(xx,yy);
          prev=row.time_s;
        }); ctx.stroke();
      });
    }
  }
  class WebPPG {
    constructor() {
      this.video = $('video'); this.canvas = $('wave'); this.ctx = this.canvas.getContext('2d');
      this.imageCanvas = document.createElement('canvas');
      this.imageContext = this.imageCanvas.getContext('2d', {willReadFrequently: true});
      this.rows = []; this.history = []; this.frames = []; this.arrivals = [];
      this.running = false; this.starting = false; this.token = 0; this.worker = null; this.stream = null;
      this.callbackId = null; this.timer = null; this.healthTimer = null; this.wakeLock = null;
      this.motion = new MotionCapture();
      this.cameraId = '';
      try { this.cameraId = window.localStorage.getItem(CAMERA_KEY) || ''; } catch (_) {}
      this.mobileCamera = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '') ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      this.iosCamera = /iPhone|iPad|iPod/i.test(navigator.userAgent || '') ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      $('start').addEventListener('click', () => this.running || this.starting ? this.stop('已停止 · 可下载本次数据') : this.startCamera());
      $('demo').addEventListener('click', () => this.startDemo());
      $('export').addEventListener('click', () => this.exportData());
      document.addEventListener('visibilitychange', () => { if (document.hidden && (this.running || this.starting)) this.stop('已切到后台 · 采集停止'); });
      window.addEventListener('pagehide', () => this.stop('页面已离开 · 采集停止'));
      window.addEventListener('resize', () => this.resize());
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.resize()).observe(this.canvas);
      if (typeof IntersectionObserver !== 'undefined') {
        const observer = new IntersectionObserver(entries => entries.forEach(entry => {
          if (entry.target === this.canvas) { this.waveVisible = entry.isIntersecting; if (entry.isIntersecting) this.paint(); }
          else { this.motion.visible = entry.isIntersecting; if (entry.isIntersecting) this.motion.render(); }
        }));
        observer.observe(this.canvas); observer.observe($('imu-accel'));
      }
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
      const box = this.canvas.getBoundingClientRect(), ratio = Math.min(window.devicePixelRatio || 1, 2);
      if (!box.width || !box.height) return;
      this.width = box.width; this.height = box.height;
      this.canvas.width = Math.round(box.width * ratio); this.canvas.height = Math.round(box.height * ratio);
      this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0); this.motion.box = null; this.paint(); this.motion.render();
    }
    paint() { if (this.width && this.waveVisible !== false) PPGView.drawWave(this.ctx, this.width, this.height, this.history, this.lastTime || 0); }
    setupSession(mode) {
      this.rows = []; this.frames = []; this.history = []; this.arrivals = [];
      this.lastTime = 0; this.lastTimestamp = null; this.lastFrameKey = null; this.lastUi = 0; this.lastPaint = 0;
      this.framesSeen = 0; this.framesSkipped = 0; this.presentedMissed = 0; this.busy = false; this.requestId = 0;
      this.pendingFrames = 0; this.cameraEvents = []; this.cameraInterruptions = []; this.cameraEnded = false;
      this.cameraMuted = false; this.cameraStalled = false; this.latestRgb = null;
      this.mode = mode; this.origin = performance.now(); this.lastFrameWall = this.origin; this.receivedFrame = false;
      this.motion.reset(mode, this.origin, !!$('imu-enabled').checked);
      this.metadata = {version: 3, build: 'single-lens-accel-v3', mode, started_at: new Date().toISOString(), backend: null, video_uploaded: false,
        session_origin_performance_ms: this.origin, performance_time_origin_unix_ms: finite(performance.timeOrigin),
        synchronization: 'PPG and IMU use the same session origin on the page performance clock. Callback times are not hardware capture times; sensor/camera delay is not calibrated.',
        requested_flash: false, requested_camera_fps: mode === 'camera' ? this.targetFps : null, filter_fs_hz: 60,
        pixel_processing: 'Original central 60% ROI only; no downscaling. RGB averaging and primary/HR processing in worker when available.',
        roi_fraction_xyxy: [.2,.2,.8,.8], bandpass_hz: [.5,5], warmup_s: 3,
        heart_rate_window_s: 8, heart_rate_minimum_initialized_s: 5, heart_rate_update_s: 1,
        timestamp_basis: mode === 'camera' ? 'performance.now() at video frame callback; relative seconds, not hardware exposure time.' : 'Synthetic 30 Hz signal times; paced demonstration, not camera measurements.'};
      $('bpm').textContent = '—'; $('fps').textContent = '—'; $('elapsed').textContent = '0.0'; $('red').textContent = '—';
      $('export').disabled = true; $('export-note').textContent = '采集后即可导出。';
      $('mode-pill').textContent = mode === 'demo' ? '演示 · 非实测' : '实时采集';
      $('mode-pill').className = 'mode-pill ' + (mode === 'demo' ? 'demo' : 'live');
      this.processor = null;
      try {
        this.worker = new Worker('worker.js?v=3');
        const token = this.token;
        this.worker.onmessage = event => {
          if (token !== this.token || !this.running) return;
          if (event.data.kind === 'error') { this.stop('计算失败：' + event.data.message); return; }
          this.pendingFrames = Math.max(0, this.pendingFrames-1); this.busy = this.pendingFrames >= 3; this.accept(event.data);
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
      $('imu-enabled').disabled = true;
      $('capture-fps').disabled = true;
      $('start').textContent = '停止采集'; $('start').disabled = false; $('demo').disabled = true;
      // One display clock for both streams. Sensor callbacks only append numeric data.
      this.uiTimer = setInterval(() => {
        if (!this.running) return;
        this.motion.tick();
        if (this.latestRgb) this.updateReadout(this.latestRgb);
        $('export').disabled = !this.hasData();
        this.paint();
        if (performance.now()-this.origin >= 300000) this.stop('已完成 5 分钟采集，请下载数据');
      }, 100);
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
      $('imu-enabled').disabled = true; $('capture-fps').disabled = true;
      this.targetFps = $('capture-fps').value === '30' ? 30 : 60;
      const motionPermission = MotionCapture.permission(!!$('imu-enabled').checked);
      $('status').textContent = '请求相机权限，请在浏览器提示中允许';
      let selection = this.cameraId;
      const constraints = {audio: false, video: {width: {ideal: 640}, height: {ideal: 480}, frameRate: {ideal: this.targetFps, max: this.targetFps},
        ...(selection ? {deviceId: {exact: selection}} : {facingMode: this.mobileCamera ? {exact: 'environment'} : {ideal: 'environment'}})}};
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (token !== this.token) { stream.getTracks().forEach(track => track.stop()); return; }
        this.stream = stream;
        let track = stream.getVideoTracks()[0];
        let devices = [];
        if (navigator.mediaDevices.enumerateDevices) {
          devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'videoinput');
          if (token !== this.token) { stream.getTracks().forEach(item => item.stop()); return; }
        }
        // Pick an individually named lens, not an environment-facing virtual camera.
        if (!selection && this.mobileCamera) {
          const physical = devices.filter(device => physicalRearScore(device.label) > 0)
            .sort((a,b) => physicalRearScore(b.label)-physicalRearScore(a.label));
          const chosen = physical[0];
          if (chosen && chosen.deviceId !== track.getSettings().deviceId) {
            selection = chosen.deviceId;
            stream.getTracks().forEach(item => item.stop()); this.stream = null;
            stream = await navigator.mediaDevices.getUserMedia({audio:false, video:{...constraints.video,
              facingMode: undefined, deviceId:{exact:selection}}});
            if (token !== this.token) { stream.getTracks().forEach(item => item.stop()); return; }
            this.stream = stream; track = stream.getVideoTracks()[0];
          }
        }
        const label = track.label || devices.find(device => device.deviceId === track.getSettings().deviceId)?.label || '';
        if (this.iosCamera && !physicalRearScore(label))
          throw new Error('未找到可确认的独立后置镜头，已停止以避免自动换镜头。请用 Safari 打开；可见镜头：' + (devices.map(device=>device.label).join('、') || label || '未提供名称'));
        const capabilities = track.getCapabilities ? track.getCapabilities() : {};
        if (capabilities.torch) {
          try { await track.applyConstraints({advanced: [{torch: false}]}); } catch (_) {}
        }
        let rateConstraint = 'ideal';
        const range = capabilities.frameRate;
        if (range && range.min <= this.targetFps && range.max >= this.targetFps) {
          try { await track.applyConstraints({frameRate:{exact:this.targetFps}}); rateConstraint = 'exact'; } catch (_) {}
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
        motionPermission.then(permission => { if (token === this.token && this.running) this.motion.start(permission); });
        this.metadata.camera_settings = settings;
        this.metadata.camera_selection = this.iosCamera ? 'Individually named rear lens, exact deviceId; old virtual-camera selection ignored.' : 'Prefer individually named rear lens; fixed deviceId.';
        this.metadata.camera_label = label; this.metadata.camera_inventory = devices.map(device=>({deviceId:device.deviceId,label:device.label}));
        this.metadata.frame_rate_constraint = rateConstraint;
        this.metadata.frame_callback = typeof this.video.requestVideoFrameCallback === 'function' ? 'requestVideoFrameCallback' : 'decoded-frame counter + requestAnimationFrame';
        $('preview-empty').hidden = true; $('roi').hidden = false; $('camera-state').textContent = '采集中';
        $('status').textContent = '等待手指覆盖摄像头';
        track.addEventListener('ended', () => {
          if (token !== this.token || !this.running) return;
          this.cameraEnded = true; this.cameraStalled = true;
          this.cameraInterruptions.push({event:'ended',time_s:(performance.now()-this.origin)/1000});
          $('camera-state').textContent = '相机已结束'; $('bpm').textContent = '—';
          $('status').textContent = '相机已结束；加速度继续记录，可停止后导出';
        });
        track.addEventListener('mute', () => {
          if (token !== this.token || !this.running) return;
          this.cameraMuted = true;
          this.cameraInterruptions.push({event:'mute',time_s:(performance.now()-this.origin)/1000});
          $('camera-state').textContent = '相机暂缓 · 等待恢复';
        });
        track.addEventListener('unmute', () => {
          if (token !== this.token || !this.running) return;
          this.cameraMuted = false;
          this.cameraInterruptions.push({event:'unmute',time_s:(performance.now()-this.origin)/1000});
          this.video.play().catch(()=>{});
        });
        this.scheduleCamera(token);
        this.healthTimer = setInterval(() => {
          const currentId = track.getSettings().deviceId;
          if (this.running && !this.cameraEnded && currentId && currentId !== this.cameraId) {
            this.stop('摄像头已发生变化，采集停止，请重新开始'); return;
          }
          const age = performance.now()-this.lastFrameWall;
          if (this.running && age > (this.receivedFrame ? 1500 : 8000)) {
            this.cameraStalled = true; $('bpm').textContent = '—';
            $('camera-state').textContent = this.cameraEnded ? '相机已结束' : '等待相机恢复';
            $('status').textContent = '暂无新相机帧；加速度独立记录中';
            if (age > 15000 && !this.motion.active) this.stop('相机没有恢复，已保留本次数据，请重新开始');
          }
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
      if (!this.running || token !== this.token || this.cameraEnded) return;
      const callback = (now, metadata) => {
        this.callbackId = null;
        if (!this.running || token !== this.token || this.cameraEnded) return;
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
      this.receivedFrame = true; this.lastFrameWall = now; this.cameraStalled = false; this.cameraMuted = false;
      const frameEvent = {time_s:t, callback_performance_ms:now, media_time_s:metadata ? metadata.mediaTime : this.video.currentTime,
        presented_frames:key, application_skipped:this.busy};
      this.cameraEvents.push(frameEvent);
      if (this.busy) { this.framesSkipped++; return; }
      const w = this.video.videoWidth, h = this.video.videoHeight;
      const x0 = Math.round(.2*w), y0 = Math.round(.2*h), rw = Math.round(.8*w)-x0, rh = Math.round(.8*h)-y0;
      if (this.imageCanvas.width !== rw || this.imageCanvas.height !== rh) {
        this.imageCanvas.width = rw; this.imageCanvas.height = rh;
        $('preview-box').style.aspectRatio = `${w} / ${h}`;
        // Match preview and source aspect ratio, including portrait camera streams.
        $('preview-box').style.maxHeight = 'none';
      }
      const captureStart = performance.now();
      this.imageContext.drawImage(this.video, x0, y0, rw, rh, 0, 0, rw, rh);
      const pixels = this.imageContext.getImageData(0, 0, rw, rh).data;
      this.submit(t, null, {...frameEvent, width:w, height:h, roi_width:rw, roi_height:rh,
        capture_readback_ms:performance.now()-captureStart}, pixels);
    }
    submit(t, rgb, frame = {}, pixels = null) {
      if (!this.running || (this.lastTimestamp !== null && t <= this.lastTimestamp)) return;
      this.lastTimestamp = t;
      const input = {id: ++this.requestId, t, rgb, frame, pixels};
      if (this.worker) {
        this.pendingFrames++; this.busy = this.pendingFrames >= 3;
        this.worker.postMessage(input, pixels ? [pixels.buffer] : []);
      }
      else {
        if (pixels) {
          rgb = [0,0,0];
          for (let i=0;i<pixels.length;i+=4) { rgb[0]+=pixels[i]; rgb[1]+=pixels[i+1]; rgb[2]+=pixels[i+2]; }
          rgb = rgb.map(value=>value/(pixels.length/4)); input.rgb = rgb;
        }
        const start = performance.now(), rows = this.processor.feed(t, rgb[0], rgb[1]);
        this.accept({...input, rows, processing_ms: performance.now() - start});
      }
    }
    accept(result) {
      const {t, rgb, frame, rows} = result;
      this.rows.push(...rows); this.history.push(...rows); this.lastTime = t;
      this.latestRgb = rgb;
      this.frames.push({time_s: t, red: rgb[0], green: rgb[1], blue: rgb[2],
        callback_performance_ms: frame.callback_performance_ms ?? null,
        media_time_s: frame.media_time_s ?? null, presented_frames: frame.presented_frames ?? null,
        roi_width:frame.roi_width ?? null, roi_height:frame.roi_height ?? null, capture_readback_ms:frame.capture_readback_ms ?? null,
        width: frame.width ?? null, height: frame.height ?? null, processing_ms: result.processing_ms});
      this.arrivals.push(t); if (this.arrivals.length > 120) this.arrivals.shift();
      while (this.history.length && this.history[0].time_s < t - 12) this.history.shift();
      const now = performance.now();
      if (now - this.lastUi >= 200) { this.updateReadout(rgb); this.lastUi = now; }
      if (t >= 300) this.stop('已完成 5 分钟采集，请下载数据');
    }
    updateReadout(rgb) {
      const row = this.rows[this.rows.length - 1], clockTime = (performance.now()-this.origin)/1000;
      let first = this.cameraEvents.length;
      while (first && this.cameraEvents[first-1].time_s >= clockTime-5) first--;
      const times = this.mode === 'camera' ? this.cameraEvents.slice(first).map(event=>event.time_s) : this.arrivals;
      const n = times.length, rate = n > 1 ? (n-1)/(times[n-1]-times[0]) : 0;
      $('bpm').textContent = !this.cameraStalled && !this.cameraMuted && row && row.heart_rate_bpm !== null ? row.heart_rate_bpm.toFixed(0) : '—';
      if (!this.cameraStalled && !this.cameraMuted) {
        $('status').textContent = PPGView.statusText(row);
        if (this.mode === 'camera') $('camera-state').textContent = '采集中';
      }
      $('fps').textContent = rate.toFixed(1); $('elapsed').textContent = (this.mode === 'camera' ? clockTime : this.lastTime).toFixed(1);
      $('red').textContent = rgb[0].toFixed(1); $('export').disabled = !this.hasData();
      $('export-note').textContent = this.mode === 'demo' ? '演示数据，文件名带 DEMO 标记。' : '数据保存在当前页面，请在关闭前下载。';
    }
    startDemo() {
      if (this.running || this.starting) return;
      ++this.token; this.setupSession('demo'); this.setRunning();
      this.motion.demoIndex = 0; this.motion.start(this.motion.enabled ? 'synthetic' : 'disabled');
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
      this.motion.stop(); this.motion.render(); $('imu-enabled').disabled = false; $('capture-fps').disabled = false;
      if (this.uiTimer) clearInterval(this.uiTimer); this.uiTimer = null;
      if (this.callbackId !== null) {
        if (this.callbackType === 'video' && this.video.cancelVideoFrameCallback) this.video.cancelVideoFrameCallback(this.callbackId);
        else cancelAnimationFrame(this.callbackId);
        this.callbackId = null;
      }
      if (this.timer) clearInterval(this.timer); this.timer = null;
      if (this.healthTimer) clearInterval(this.healthTimer); this.healthTimer = null;
      if (this.worker) this.worker.terminate(); this.worker = null;
      this.framesSkipped += this.pendingFrames || 0; this.pendingFrames = 0; this.busy = false;
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
      $('export').disabled = !this.hasData(); this.paint(); this.environment();
    }
    hasData() { return this.rows.length > 0 || this.frames.length > 0 || this.motion.rows.length > 0; }
    exportData() {
      if (!this.hasData()) return;
      if (this.running || this.starting) this.stop('已停止 · 正在导出本次数据');
      const type = $('export-type').value;
      let content, extension, mime;
      const metadata = {...this.metadata, exported_at: new Date().toISOString(), imu: this.motion.summary(),
          camera_interruptions: this.cameraInterruptions,
          frames_received: this.framesSeen, processed_frames: this.frames.length, application_skipped_frames: this.framesSkipped,
          missed_presented_frames: this.presentedMissed, waveform_rows: this.rows.length};
      if (type === 'metadata' || type === 'session') {
        content = JSON.stringify(type === 'session' ? {metadata, waveform: this.rows, frames: this.frames, camera_events: this.cameraEvents, imu: this.motion.rows} : metadata, null, 2);
        extension = '.json'; mime = 'application/json';
        if (type === 'session') extension = '_session.json';
      } else if (type === 'imu') {
        const keys = ['time_s','callback_performance_ms','event_timestamp_ms','reported_interval_ms',...MOTION_FIELDS,'has_sensor_value'];
        content = keys.join(',') + '\n' + this.motion.rows.map(row => keys.map(key => row[key] ?? '').join(',')).join('\n') + '\n';
        extension = '_imu.csv'; mime = 'text/csv;charset=utf-8';
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
