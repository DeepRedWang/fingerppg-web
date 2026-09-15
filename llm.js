/* Optional summary-only connection. Prompts and vLLM credentials stay on the server. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  class Interpretation {
    constructor(onChange) {
      this.onChange = onChange; this.generation = 0; this.results = []; this.state = 'idle'; this.attempts = 0;
      this.message = '配置你的服务器并启用后，首个有效 30 s 窗口自动解读一次。';
      try {
        const saved = JSON.parse(window.localStorage.getItem('fingerppg.llm.v1') || '{}');
        $('llm-url').value = saved.url || ''; $('llm-prompt').value = saved.prompt || 'brief';
      } catch (_) {}
      $('llm-enabled').checked = false;
      $('llm-send').addEventListener('click', () => this.send());
      $('llm-enabled').addEventListener('change', () => {
        if (!$('llm-enabled').checked) this.cancel('已关闭 AI 解读');
        this.render();
      });
      this.render();
    }
    cancel(message) {
      ++this.generation;
      if (this.controller) this.controller.abort();
      this.controller = null;
      if (this.state === 'loading') { this.state = 'cancelled'; this.message = message; }
      this.render();
    }
    reset(mode) {
      this.cancel('上一会话的解读已取消'); this.mode = mode;
      this.first = null; this.result = null; this.results = []; this.requestIds = {}; this.attempts = 0;
      this.context = $('llm-context').value || 'unknown'; this.state = 'waiting';
      this.message = mode === 'demo' ? '合成演示不自动上传；满 30 s 后可手动测试解读。' :
        '等待本次采集的首个有效 30 s HRV 窗口。';
      this.render();
    }
    consider(hrv) {
      if (this.first || hrv?.status !== 'tracking' || hrv.window_s !== 30 ||
          hrv.interval_count < 15 || hrv.interval_span_s < 26 || hrv.rejected_interval_count > 0 ||
          !['time_s','interval_count','interval_span_s','mean_ppi_ms','sdrr_ms','rmssd_ms','pnn50_pct'].every(key => Number.isFinite(hrv[key])) ||
          hrv.mean_ppi_ms <= 0) return;
      // Explicit scalar allowlist: no video, raw intervals, IMU or device IDs.
      this.first = {source:'phone_ppg', mode:this.mode, context:this.context,
        window_s:30, window_end_s:hrv.time_s, interval_count:hrv.interval_count,
        interval_span_s:hrv.interval_span_s, mean_ppi_ms:hrv.mean_ppi_ms,
        sdrr_ms:hrv.sdrr_ms, rmssd_ms:hrv.rmssd_ms, pnn50_pct:hrv.pnn50_pct,
        lf_hf_ratio:Number.isFinite(hrv.lf_hf_ratio) ? hrv.lf_hf_ratio : null,
        lf_hf_status:Number.isFinite(hrv.lf_hf_ratio) ? 'exploratory' :
          hrv.lf_hf_status === 'low_variance' ? 'low_variance' : 'unavailable'};
      this.message = `首个有效窗口已保存（截至 ${hrv.time_s.toFixed(1)} s），可选择解读方式。`;
      this.render();
      if (this.mode === 'camera' && $('llm-enabled').checked) this.send();
    }
    settings() {
      const raw = $('llm-url').value.trim(), key = $('llm-token').value.trim();
      let url;
      try { url = new URL(raw); } catch (_) { throw new Error('请填写服务器的完整 HTTPS 地址'); }
      const local = ['localhost','127.0.0.1','[::1]'];
      const localTest = local.includes(window.location?.hostname) && local.includes(url.hostname);
      if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && localTest)) || url.username || url.password || url.search || url.hash || url.pathname !== '/')
        throw new Error('请填写 HTTPS 服务地址，例如 https://ppg.example.com，不含路径或密钥');
      if (key.length < 32) throw new Error('请填写服务器提供的访问口令（仅保留在当前页面）');
      const prompt = $('llm-prompt').value;
      if (!['brief','quality','recovery','research'].includes(prompt)) throw new Error('请选择解读方式');
      try { window.localStorage.setItem('fingerppg.llm.v1', JSON.stringify({url:url.origin,prompt})); } catch (_) {}
      return {url:url.origin, key, prompt};
    }
    async send() {
      if (!this.first || this.state === 'loading' || !$('llm-enabled').checked) return;
      let config;
      try { config = this.settings(); }
      catch (error) { this.state = 'error'; this.message = error.message; this.render(); return; }
      const generation = ++this.generation, controller = new AbortController();
      this.controller = controller; this.state = 'loading'; this.result = null;
      this.message = '正在解读首个有效窗口，采集继续…'; this.render();
      const timer = setTimeout(() => controller.abort(), 95000);
      try {
        // Stable per snapshot + prompt: a retry does not duplicate a completed inference.
        if (!this.requestIds[config.prompt]) this.requestIds[config.prompt] = window.crypto.randomUUID();
        const payload = {request_id:this.requestIds[config.prompt], prompt_id:config.prompt, measurement:{...this.first}};
        this.attempts++;
        const response = await window.fetch(config.url + '/api/interpret', {
          method:'POST', headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.key},
          body:JSON.stringify(payload), signal:controller.signal, cache:'no-store', credentials:'omit',
          redirect:'error', referrerPolicy:'no-referrer'});
        if (!response.ok) {
          const messages = {401:'访问口令不正确',403:'服务器未允许本网页访问',409:'请求编号冲突，请重新开始采集',
            422:'服务器拒绝了不一致的 HRV 数据',429:'服务器繁忙，请稍后手动重试',502:'模型尚未就绪',504:'模型解读超时'};
          throw new Error(messages[response.status] || `服务器返回错误 ${response.status}`);
        }
        const answer = await response.json();
        if (generation !== this.generation) return;
        if (typeof answer.text !== 'string' || !answer.text.trim() || answer.text.length > 4000 ||
            answer.request_id !== payload.request_id || answer.prompt_id !== payload.prompt_id ||
            answer.window_end_s !== payload.measurement.window_end_s) throw new Error('服务器返回的解读与本次窗口不匹配');
        this.result = {prompt_id:answer.prompt_id, prompt_version:String(answer.prompt_version || '').slice(0,80),
          model:String(answer.model || '').slice(0,120), window_end_s:answer.window_end_s,
          text:answer.text, truncated:!!answer.truncated};
        this.results.push({...this.result}); if (this.results.length > 12) this.results.shift();
        this.state = 'done'; this.message = `解读完成 · 对应 ${answer.window_end_s.toFixed(1)} s 时的 30 s 窗口${answer.truncated?' · 输出被截断':''}`;
      } catch (error) {
        if (generation !== this.generation) return;
        this.state = 'error'; this.message = error.name === 'AbortError' ? '解读超时；可手动重试，采集不受影响' :
          error instanceof TypeError ? '无法连接解读服务器，请检查 HTTPS、网络和跨域设置' : error.message;
      } finally {
        clearTimeout(timer);
        if (generation === this.generation) { this.controller = null; this.render(); }
      }
    }
    render() {
      $('llm-status').textContent = this.message;
      $('llm-output').textContent = this.result?.text || '';
      $('llm-output').hidden = !this.result;
      $('llm-send').disabled = !this.first || this.state === 'loading' || !$('llm-enabled').checked;
      $('llm-send').textContent = this.mode === 'demo' ? '用合成数据测试解读' : this.results.length ? '用所选方式解读此窗口' : '解读首个有效窗口 / 重试';
      this.onChange?.();
    }
    summary() {
      return {enabled:!!$('llm-enabled').checked, status:this.state, request_attempts:this.attempts,
        snapshot:this.first || null, results:this.results, processing:'optional_server_summary_only',
        automatic_requests:'Once at first valid 30 s window per camera session; no automatic retries; demo is manual only.'};
    }
  }
  window.FingerPPGInterpretation = Interpretation;
})();
