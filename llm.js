/* One automatic interpretation per valid 30 s measurement; credentials stay out of reports. */
(function () {
  'use strict';
  const $=id=>document.getElementById(id);
  const API='https://fingerppg-ai.fingerppg-ai-worker.workers.dev';
  class Interpretation {
    constructor(onChange) {
      this.onChange=onChange;this.generation=0;this.results=[];this.state='idle';this.attempts=0;this.autoAttempted=false;
      this.message='启用后，首个有效 30 秒 HRV 结果出来就自动分析。';
      $('llm-enabled').checked=false;
      $('llm-send').addEventListener('click',()=>this.send());
      $('report-save')?.addEventListener('click',()=>this.saveReport());
      $('llm-token').addEventListener('change',()=>this.maybeAuto());
      $('llm-enabled').addEventListener('change',()=>{
        if(!$('llm-enabled').checked) {this.cancel('已关闭 AI 分析');$('llm-token').value='';}
        else this.maybeAuto();
        this.render();
      });
      this.render();
    }
    cancel(message) {
      ++this.generation;if(this.controller) this.controller.abort();this.controller=null;
      if(this.state==='loading') {this.state='cancelled';this.message=message+'；已发出的请求可能仍占用次数';}
      this.render();
    }
    reset(mode) {
      this.cancel('上一会话的分析已取消');this.mode=mode;this.snapshot=null;this.result=null;this.results=[];
      this.attempts=0;this.autoAttempted=false;this.state='waiting';
      this.message='等待首个有效 30 秒 HRV 结果…';this.render();
    }
    consider(hrv) {
      if(this.snapshot||hrv?.status!=='tracking'||hrv.window_s!==30||hrv.interval_count<15||hrv.interval_span_s<26||
          hrv.rejected_interval_count>0||
          !['time_s','interval_count','interval_span_s','mean_ppi_ms','sdrr_ms','rmssd_ms','pnn50_pct'].every(k=>Number.isFinite(hrv[k]))||
          hrv.mean_ppi_ms<300||hrv.mean_ppi_ms>1500||hrv.time_s<30||hrv.time_s>301) return;
      // Same 30 s window for HR and PRV, with no raw intervals, images, IMU or device identifiers.
      this.snapshot={schema:'ppg-trends-1',source:'phone_ppg',mode:this.mode,context:'unknown',windows:[{
        window_s:30,window_end_s:hrv.time_s,interval_count:hrv.interval_count,interval_span_s:hrv.interval_span_s,
        mean_ppi_ms:hrv.mean_ppi_ms,sdrr_ms:hrv.sdrr_ms,rmssd_ms:hrv.rmssd_ms,pnn50_pct:hrv.pnn50_pct}]};
      this.measuredAt=new Date().toISOString();this.message='30 秒 HRV 已就绪，报告数据已保存。';
      this.render();this.maybeAuto();
    }
    maybeAuto() {
      if(this.mode==='camera'&&this.snapshot&&$('llm-enabled').checked&&!this.autoAttempted&&this.state!=='loading') this.send();
    }
    settings() {
      const key=$('llm-token').value.trim();
      if(/^sk-/i.test(key)) throw new Error('这里填写独立访问口令，不是 DeepSeek API key');
      if(key.length<32||key.length>200) throw new Error('请在“访问设置”中填写口令，填好后会自动分析');
      return {key};
    }
    async send() {
      if(!this.snapshot||this.state==='loading'||this.state==='done'||this.state==='quota'||!$('llm-enabled').checked) return;
      let config;
      try {config=this.settings();}
      catch(error) {this.state='credentials';this.message=error.message;this.render();return;}
      this.autoAttempted=true;
      const generation=++this.generation,controller=new AbortController();
      this.controller=controller;this.state='loading';this.result=null;
      this.message='正在分析心率和 HRV，采集继续…';this.render();
      const timer=setTimeout(()=>controller.abort(),70000);
      try {
        const payload={request_id:window.crypto.randomUUID(),prompt_id:'summary',measurement:this.snapshot};
        this.attempts++;
        const response=await window.fetch(API+'/api/interpret',{
          method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.key},
          body:JSON.stringify(payload),signal:controller.signal,cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'});
        if(!response.ok) {
          const messages={401:'访问口令不正确，请修改后重试',403:'当前网页来源未获允许',422:'本次 HRV 数据未通过校验',
            429:'调用次数已达上限，请稍后再试',502:'AI 服务暂时不可用，可手动重试',503:'AI 服务暂时不可用',504:'AI 分析超时，可手动重试'};
          let code='';try {code=(await response.json()).error;} catch(_) {}
          const error=new Error(code==='daily_limit'?'今日 10 次已用完，北京时间零点恢复':messages[response.status]||'AI 分析暂时不可用');
          error.dailyLimit=code==='daily_limit';throw error;
        }
        const answer=await response.json();if(generation!==this.generation) return;
        if(typeof answer.text!=='string'||!answer.text.trim()||answer.text.length>4000||
            answer.request_id!==payload.request_id||answer.prompt_id!==payload.prompt_id||
            answer.window_end_s!==this.snapshot.windows[0].window_end_s||!/^[0-9a-f]{64}$/.test(answer.snapshot_hash))
          throw new Error('返回结果与本次测量不匹配');
        this.result={request_id:answer.request_id,prompt_id:answer.prompt_id,prompt_version:String(answer.prompt_version||'').slice(0,80),
          model:String(answer.model||'').slice(0,120),snapshot_hash:answer.snapshot_hash,measurement:this.snapshot,
          created_at:new Date().toISOString(),text:answer.text,truncated:!!answer.truncated};
        this.results.push(this.result);this.state='done';
        this.message=answer.truncated?'分析完成，文字可能未完整生成':'分析完成，本次采集不再重复调用。';
      } catch(error) {
        if(generation!==this.generation) return;
        this.state=error.dailyLimit?'quota':'error';this.message=error.name==='AbortError'?'分析超时；不会自动重试，已发出的请求可能仍占用次数':
          error instanceof TypeError?'AI 暂时连接不上，采集和报告数据不受影响':error.message;
      } finally {clearTimeout(timer);if(generation===this.generation) {this.controller=null;this.render();}}
    }
    reportLines() {
      const w=this.snapshot?.windows[0];
      return w?[`平均心率 ${(60000/w.mean_ppi_ms).toFixed(1)} bpm`,
        `SDRR ${w.sdrr_ms.toFixed(1)} ms  ·  RMSSD ${w.rmssd_ms.toFixed(1)} ms`,
        `pNN50 ${w.pnn50_pct.toFixed(1)}%  ·  30 秒窗口`,
        `采集第 ${(w.window_end_s-30).toFixed(1)}–${w.window_end_s.toFixed(1)} 秒`]:[];
    }
    render() {
      $('llm-status').textContent=this.message;
      $('llm-output').textContent=this.result?.text||'';$('llm-output').hidden=!this.result;
      $('llm-send').hidden=!['error','cancelled','credentials'].includes(this.state)&&!(this.mode==='demo'&&this.snapshot&&this.state!=='done');
      $('llm-send').disabled=!this.snapshot||this.state==='loading'||!$('llm-enabled').checked;
      $('llm-send').textContent=this.attempts?'重试分析':'开始分析';
      if($('report-status')) {
        $('capture-report')?.classList?.toggle('has-report',!!this.snapshot);
        $('report-status').textContent=this.mode==='demo'?'合成演示':this.result?'分析完成':this.snapshot?'数据已就绪':'等待 30 秒 HRV';
        $('report-metrics').textContent=this.reportLines().slice(0,3).join('\n');
        $('report-window').textContent=this.snapshot?this.reportLines()[3]:'本次心率与 HRV 报告';
        $('report-text').textContent=this.result?.text||(!$('llm-enabled').checked?'启用 AI 后，HRV 就绪即可分析。':this.message);
        $('report-save').disabled=!this.snapshot;
      }
      this.onChange?.();
    }
    saveReport() {
      if(!this.snapshot) return;
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
      const width=900,pad=54,lineHeight=42,maxWidth=width-pad*2;
      ctx.font='28px sans-serif';
      const wrap=text=>{
        const lines=[];for(const paragraph of text.split('\n')) {
          if(!paragraph) {lines.push('');continue;}
          let line='';for(const character of paragraph) {
            if(line&&ctx.measureText(line+character).width>maxWidth) {lines.push(line);line='';}line+=character;
          }lines.push(line);
        }return lines;
      };
      const text=this.result?.text||'AI 分析尚未完成。以下仅为测量数据记录。';
      const lines=[...this.reportLines(),'',...wrap(text),'','短时 PPG 指标，仅供日常参考。'];
      canvas.width=width;canvas.height=220+lines.length*lineHeight+pad;
      ctx.fillStyle='#0b1b2c';ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle='#83e9ca';ctx.font='bold 40px sans-serif';ctx.fillText('FingerPPG · 心率与 HRV 报告',pad,76);
      ctx.fillStyle='#b9ccd9';ctx.font='24px sans-serif';
      ctx.fillText((this.mode==='demo'?'合成演示 · ':'')+new Date(this.measuredAt).toLocaleString(),pad,122);
      ctx.font='28px sans-serif';ctx.fillStyle='#e8f0f4';
      lines.forEach((line,i)=>ctx.fillText(line,pad,190+i*lineHeight));
      canvas.toBlob(blob=>{
        if(!blob) return;
        const url=URL.createObjectURL(blob),a=document.createElement('a');
        a.href=url;a.download='FingerPPG_report_'+this.measuredAt.replace(/[:.]/g,'-')+'.png';
        document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      },'image/png');
    }
    summary() {
      return {schema:'ppg-ai-summary-2',enabled:!!$('llm-enabled').checked,status:this.state,request_attempts:this.attempts,
        snapshot:this.snapshot||null,results:this.results,processing:'optional_cloudflare_deepseek_scalar_summary',
        automatic_requests:'Once per camera session at the first valid 30 s HRV window; demo manual; no automatic retries',daily_limit:10};
    }
  }
  window.FingerPPGInterpretation=Interpretation;
})();
