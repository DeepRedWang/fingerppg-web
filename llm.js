/* Optional scalar-trend interpretation. Provider key and prompts stay in the Worker. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const PROMPTS = {brief:'A · 自然段',structured:'B · 固定结构',evidence:'C · 依据优先'};
  class Interpretation {
    constructor(onChange) {
      this.onChange=onChange;this.generation=0;this.results=[];this.windows=[];this.state='idle';this.attempts=0;this.group=0;
      this.message='采集后手动分析心率与 HRV 变化；选择不同 prompt 或重复运行，比较同一份数据。';
      try {
        const saved=JSON.parse(window.localStorage.getItem('fingerppg.llm.v2')||'{}');
        $('llm-url').value=saved.url||'https://fingerppg-ai.fingerppg-ai-worker.workers.dev';$('llm-prompt').value=Object.hasOwn(PROMPTS,saved.prompt)?saved.prompt:'brief';
      } catch(_) {}
      $('llm-enabled').checked=false;
      $('llm-send').addEventListener('click',()=>this.send());
      $('llm-refresh').addEventListener('click',()=>this.useLatest());
      $('llm-export').addEventListener('click',()=>this.exportComparison());
      $('llm-enabled').addEventListener('change',()=>{
        if(!$('llm-enabled').checked) {this.cancel('已关闭 AI 解读');$('llm-token').value='';}
        this.render();
      });
      this.render();
    }
    cancel(message) {
      ++this.generation;
      if(this.controller) this.controller.abort();
      this.controller=null;
      if(this.state==='loading') {this.state='cancelled';this.message=message+'；已发出的请求可能仍会计费';}
      this.render();
    }
    reset(mode) {
      this.cancel('上一会话的解读已取消');this.mode=mode;
      this.windows=[];this.snapshot=null;this.result=null;this.results=[];this.attempts=0;this.group=0;
      this.context=$('llm-context').value||'unknown';this.state='waiting';
      this.message='等待有效的 30 秒 HRV 窗口；数据仅在点击分析时上传。';this.render();
    }
    consider(hrv) {
      if(hrv?.status!=='tracking'||hrv.window_s!==30||hrv.interval_count<15||hrv.interval_span_s<26||
          hrv.rejected_interval_count>0||
          !['time_s','interval_count','interval_span_s','mean_ppi_ms','sdrr_ms','rmssd_ms','pnn50_pct'].every(k=>Number.isFinite(hrv[k]))||
          hrv.mean_ppi_ms<300||hrv.mean_ppi_ms>1500||hrv.time_s<30||hrv.time_s>301||
          hrv.time_s-(this.windows.at(-1)?.window_end_s??-Infinity)<4) return;
      // Explicit scalar allowlist; neither raw PPI/IMU nor device identifiers are uploaded.
      this.windows.push({window_s:30,window_end_s:hrv.time_s,interval_count:hrv.interval_count,
        interval_span_s:hrv.interval_span_s,mean_ppi_ms:hrv.mean_ppi_ms,sdrr_ms:hrv.sdrr_ms,
        rmssd_ms:hrv.rmssd_ms,pnn50_pct:hrv.pnn50_pct});
      if(this.windows.length>55) this.windows.shift();
      if(!this.snapshot && this.state!=='loading') this.message=`已有 ${this.windows.length} 个有效窗口，可手动分析${this.windows.length===1?'；单个窗口还不能判断变化':''}。`;
      this.render();
    }
    useLatest() {
      if(this.state==='loading'||!this.windows.length) return;
      this.snapshot=null;this.snapshotHash=null;this.result=null;this.state='ready';
      this.message='下次分析将固定最新数据，建立新的对比组；已有结果保留在导出文件中。';this.render();
    }
    settings() {
      const raw=$('llm-url').value.trim(),key=$('llm-token').value.trim();let url;
      try {url=new URL(raw);} catch(_) {throw new Error('请填写 Worker 的完整 HTTPS 地址');}
      const local=['localhost','127.0.0.1','[::1]'];
      const localTest=local.includes(window.location?.hostname)&&local.includes(url.hostname);
      if((url.protocol!=='https:'&&!(url.protocol==='http:'&&localTest))||url.username||url.password||url.search||url.hash||url.pathname!=='/')
        throw new Error('请填写 HTTPS 服务地址，不含路径、查询参数或密钥');
      if(/^sk-/i.test(key)) throw new Error('这里填写独立的 Worker 访问口令，请勿填写 DeepSeek API key');
      if(key.length<32||key.length>200) throw new Error('请填写 Worker 的独立访问口令（仅留在当前页面）');
      const prompt=$('llm-prompt').value;
      if(!Object.hasOwn(PROMPTS,prompt)) throw new Error('请选择 prompt');
      try {window.localStorage.setItem('fingerppg.llm.v2',JSON.stringify({url:url.origin,prompt}));} catch(_) {}
      return {url:url.origin,key,prompt};
    }
    async send() {
      if(!this.windows.length||this.state==='loading'||!$('llm-enabled').checked) return;
      if(this.results.length>=30) {this.message='已保留 30 次结果，请先导出；开始新采集会清空当前对比。';this.render();return;}
      let config;
      try {config=this.settings();}
      catch(error) {this.state='error';this.message=error.message;this.render();return;}
      if(!this.snapshot) {
        this.snapshot={schema:'ppg-trends-1',source:'phone_ppg',mode:this.mode,context:this.context,
          windows:this.windows.map(w=>({...w}))};this.snapshotHash=null;++this.group;
      }
      const generation=++this.generation,controller=new AbortController();
      this.controller=controller;this.state='loading';this.result=null;
      this.message=`正在用 ${PROMPTS[config.prompt]} 分析第 ${this.group} 组数据…`;this.render();
      const timer=setTimeout(()=>controller.abort(),70000);
      try {
        // Each explicit click is a NEW paid inference, including repeated prompts. Never auto-retry.
        const payload={request_id:window.crypto.randomUUID(),prompt_id:config.prompt,measurement:this.snapshot};
        this.attempts++;
        const response=await window.fetch(config.url+'/api/interpret',{
          method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.key},
          body:JSON.stringify(payload),signal:controller.signal,cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'});
        if(!response.ok) {
          const messages={401:'访问口令不正确',403:'Worker 未允许当前网页来源',413:'数据过大',422:'数据格式或 HRV 数值不一致',
            429:'已达到每分钟或每日调用上限，请稍后再试',502:'DeepSeek 暂时不可用，请检查 Worker 配置或账户额度',503:'Worker 尚未配置完成',504:'DeepSeek 分析超时'};
          throw new Error(messages[response.status]||`服务返回错误 ${response.status}`);
        }
        const answer=await response.json();if(generation!==this.generation) return;
        if(typeof answer.text!=='string'||!answer.text.trim()||answer.text.length>4000||
            answer.request_id!==payload.request_id||answer.prompt_id!==payload.prompt_id||
            answer.window_end_s!==this.snapshot.windows.at(-1).window_end_s||
            !/^[0-9a-f]{64}$/.test(answer.snapshot_hash)||
            (this.snapshotHash && this.snapshotHash!==answer.snapshot_hash)) throw new Error('返回结果与本次固定数据不匹配');
        this.snapshotHash=answer.snapshot_hash;
        this.result={request_id:answer.request_id,group:this.group,prompt_id:answer.prompt_id,
          prompt_version:String(answer.prompt_version||'').slice(0,80),model:String(answer.model||'').slice(0,120),
          provider_model:String(answer.provider_model||'').slice(0,120),snapshot_hash:answer.snapshot_hash,
          settings:{temperature:answer.settings?.temperature,max_tokens:answer.settings?.max_tokens,thinking:answer.settings?.thinking?.type},
          usage:{prompt_tokens:answer.usage?.prompt_tokens,completion_tokens:answer.usage?.completion_tokens,total_tokens:answer.usage?.total_tokens},
          measurement:this.snapshot,created_at:new Date().toISOString(),text:answer.text,truncated:!!answer.truncated};
        this.results.push(this.result);this.state='done';
        this.message=`第 ${this.group} 组 · ${PROMPTS[config.prompt]} 完成；可换 prompt 或重复运行${answer.truncated?'（本次输出被截断）':''}。`;
      } catch(error) {
        if(generation!==this.generation) return;
        this.state='error';this.message=error.name==='AbortError'?'请求超时；已发出的请求可能仍会计费，不会自动重试':
          error instanceof TypeError?'无法连接 Worker，请检查 HTTPS、网络和来源配置':error.message;
      } finally {clearTimeout(timer);if(generation===this.generation) {this.controller=null;this.render();}}
    }
    exportComparison() {
      if(!this.results.length) return;
      const url=URL.createObjectURL(new Blob([JSON.stringify(this.summary(),null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='fingerppg_ai_comparison_'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';
      document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    render() {
      $('llm-status').textContent=this.message;
      $('llm-output').textContent=this.result?.text||'';$('llm-output').hidden=!this.result;
      const busy=this.state==='loading';
      $('llm-send').disabled=!this.windows.length||busy||!$('llm-enabled').checked;
      $('llm-send').textContent=this.snapshot?'用所选 prompt 再运行一次':'固定当前数据并分析';
      $('llm-refresh').disabled=!this.snapshot||busy;
      $('llm-export').disabled=!this.results.length;
      const rows=this.snapshot?.windows||this.windows;
      $('llm-dataset').textContent=rows.length?`${this.snapshot?'已固定第 '+this.group+' 组':'待固定数据'}：${Math.max(0,rows[0].window_end_s-30).toFixed(1)}–${rows.at(-1).window_end_s.toFixed(1)} s，${rows.length} 个窗口。${this.snapshot?' 新窗口不会改变本组输入。':''}`:'尚无有效窗口';
      $('llm-history').textContent=this.results.map((r,i)=>`${i+1}. 第 ${r.group} 组 · ${PROMPTS[r.prompt_id]} · ${r.model}${r.truncated?' · 截断':''}`).join('\n');
      this.onChange?.();
    }
    summary() {
      return {schema:'ppg-ai-comparison-1',enabled:!!$('llm-enabled').checked,status:this.state,request_attempts:this.attempts,
        snapshot:this.snapshot||null,results:this.results,processing:'optional_cloudflare_deepseek_scalar_trends',
        automatic_requests:'none; every explicit run is a new inference; no automatic retries',
        comparison_note:'Compare runs within the same group and snapshot_hash; record prompt_version, model and settings. Overlapping windows are not independent measurements.'};
    }
  }
  window.FingerPPGInterpretation=Interpretation;
})();
