/* Shared drawing, ROI and export helpers for the mobile application. */
(function (root) {
  'use strict';
  function rgbMean(data, width, height) {
    const x0 = Math.round(.2 * width), x1 = Math.round(.8 * width);
    const y0 = Math.round(.2 * height), y1 = Math.round(.8 * height);
    let r = 0, g = 0, b = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2];
    }
    const n = (x1 - x0) * (y1 - y0);
    return [r / n, g / n, b / n];
  }
  function statusText(row) {
    if (!row) return '点击开始，采集指尖信号';
    const labels = {warming_up: '估计中 · 滤波初始化', collecting: '估计中 · 请保持手指稳定',
      tracking: '正在估计 · 最近 8 秒，每秒更新', unreliable: '波形不够稳定，暂不输出心率',
      low_frame_rate: '到帧率偏低，暂不输出心率', low_light: '光照不足 · 请调整位置或环境光',
      no_finger: '等待手指覆盖摄像头', invalid_intensity: '无有效光学信号', invalid_signal: '无有效波形'};
    return labels[row.heart_rate_status] || '估计中';
  }
  function csv(rows) {
    if (!rows.length) return '';
    const keys = Object.keys(rows[0]);
    const value = v => v == null ? '' : typeof v === 'boolean' ? (v ? 'True' : 'False') :
      '"' + String(v).replace(/"/g, '""') + '"';
    return '\ufeff' + keys.join(',') + '\n' + rows.map(r => keys.map(k => value(r[k])).join(',')).join('\n') + '\n';
  }
  function drawWave(ctx, width, height, rows, time) {
    const l = 44, r = width - 12, t = 25, b = height - 30;
    ctx.clearRect(0, 0, width, height); ctx.fillStyle = '#11263b'; ctx.fillRect(0, 0, width, height);
    const end = Math.max(10, time), start = end - 10;
    const visible = rows.filter(row => row.time_s >= start && row.time_s <= end);
    let limit = .5;
    visible.forEach(row => { if (row.primary_bvp !== null) limit = Math.max(limit, Math.abs(row.primary_bvp * 1000) * 1.15); });
    ctx.font = '10px sans-serif'; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = t + i * (b - t) / 4;
      ctx.strokeStyle = '#264055'; ctx.beginPath(); ctx.moveTo(l, y); ctx.lineTo(r, y); ctx.stroke();
      ctx.fillStyle = '#91a9bb'; ctx.textAlign = 'right'; ctx.fillText((limit * (1 - i / 2)).toPrecision(2), l - 7, y + 3);
    }
    for (let i = 0; i <= 5; i++) {
      const x = l + i * (r - l) / 5;
      ctx.strokeStyle = '#1c354a'; ctx.beginPath(); ctx.moveTo(x, t); ctx.lineTo(x, b); ctx.stroke();
      ctx.fillStyle = '#91a9bb'; ctx.textAlign = 'center'; ctx.fillText((start + 2 * i).toFixed(0), x, b + 18);
    }
    ctx.fillStyle = '#91a9bb'; ctx.textAlign = 'left'; ctx.fillText('相对幅度 ×1000', l, 14);
    ctx.textAlign = 'right'; ctx.fillText('秒', r, 14);
    let group = null, previous = null;
    ctx.lineWidth = 2;
    for (const row of visible) {
      if (row.primary_bvp === null) { previous = null; group = null; continue; }
      const key = `${row.segment}/${row.ready}`;
      const x = l + (row.time_s - start) / 10 * (r - l), y = (t + b) / 2 - row.primary_bvp * 1000 / limit * (b - t) / 2;
      if (previous && key === group) {
        ctx.strokeStyle = row.ready ? '#7ce0c4' : '#8393a5'; ctx.beginPath();
        ctx.moveTo(previous[0], previous[1]); ctx.lineTo(x, y); ctx.stroke();
      }
      group = key; previous = [x, y];
    }
  }
  const api = {rgbMean, statusText, csv, drawWave};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PPGView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
