/* Experimental IMU magnitude-spectrum guided attenuation. No phase cancellation. */
(function(root){
  'use strict';
  const defaultCore=typeof module!=='undefined'&&module.exports?require('./ppg-core'):root.FingerPPG;
  const SETTINGS=Object.freeze({revision:'spectral-v1',fs_hz:60,window_s:8,hop_s:1,
    reconstruction_center_s:2,output_delay_s:[4,5],fft_size:1024,
    frequency_resolution_hz:.125,motion_band_hz:[.5,5],hr_band_bpm:[40,200],
    peak_match_hz:.20,notch_flat_width_hz:.12,notch_half_width_hz:.32,minimum_gain:.10,
    min_motion_rms_m_s2:.04,max_imu_gap_s:.25,max_edge_hold_s:.12,
    max_abs_acceleration_m_s2:100,hrv_policy:'Withheld for the entire enabled experimental session; filtered beat timing is not validated.',
    method:'Sum of three independent IMU power spectra; shared spectral peaks attenuated in the PPG complex spectrum, preserving PPG phase. Central-window overlap-add reconstruction; no IMU phase or samplewise regression.'});
  const FIELDS=['accel_x_m_s2','accel_y_m_s2','accel_z_m_s2'];
  const median=a=>{const b=[...a].sort((x,y)=>x-y),i=b.length>>1;return b.length%2?b[i]:(b[i-1]+b[i])/2;};
  function fft(re,im,inverse=false){
    const n=re.length;
    for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}}
    for(let size=2;size<=n;size<<=1){const angle=(inverse?2:-2)*Math.PI/size,wr=Math.cos(angle),wi=Math.sin(angle);
      for(let start=0;start<n;start+=size){let ur=1,ui=0;for(let j=0;j<size/2;j++){
        const a=start+j,b=a+size/2,tr=ur*re[b]-ui*im[b],ti=ur*im[b]+ui*re[b];
        re[b]=re[a]-tr;im[b]=im[a]-ti;re[a]+=tr;im[a]+=ti;
        const next=ur*wr-ui*wi;ui=ur*wi+ui*wr;ur=next;
      }}
    }
    if(inverse)for(let i=0;i<n;i++){re[i]/=n;im[i]/=n;}
  }
  function transform(values){
    const n=values.length,center=(n-1)/2,mean=values.reduce((s,v)=>s+v,0)/n;
    let numerator=0,denominator=0;
    values.forEach((v,i)=>{numerator+=(i-center)*(v-mean);denominator+=(i-center)**2;});
    const slope=numerator/denominator,re=new Float64Array(SETTINGS.fft_size),im=new Float64Array(re.length),window=[];
    for(let i=0;i<n;i++){const w=.5-.5*Math.cos(2*Math.PI*i/n);window.push(w);re[i]=(values[i]-mean-slope*(i-center))*w;}
    fft(re,im);const power=Array.from({length:re.length/2+1},(_,k)=>re[k]**2+im[k]**2);
    return {re,im,power,mean,slope,center,window};
  }
  const frequency=k=>k*SETTINGS.fs_hz/SETTINGS.fft_size;
  function peaks(power,lo,hi,relative=.04){
    const selected=power.map((p,k)=>({p,k,f:frequency(k)})).filter(v=>v.f>=lo&&v.f<=hi);
    const maximum=Math.max(0,...selected.map(v=>v.p));
    if(maximum<1e-20)return [];
    return selected.filter(v=>v.p>=maximum*relative&&v.p>power[v.k-1]&&v.p>=power[v.k+1]).map(v=>{
      const l=Math.log(Math.max(1e-30,power[v.k-1])),m=Math.log(v.p),r=Math.log(Math.max(1e-30,power[v.k+1]));
      const delta=Math.max(-.5,Math.min(.5,.5*(l-r)/(l-2*m+r)||0));
      return {...v,f:frequency(v.k+delta)};
    }).sort((a,b)=>b.p-a.p);
  }
  function analyzeWindow(ppg,axes,previousPulseHz=null){
    const p=transform(ppg),gains=new Float64Array(SETTINGS.fft_size/2+1).fill(1);
    const motionPower=new Array(gains.length).fill(0);
    let rms=0;
    for(const axis of axes){const a=transform(axis);for(let k=0;k<motionPower.length;k++)motionPower[k]+=a.power[k];
      rms+=axis.reduce((s,v,i)=>s+(v-a.mean-a.slope*(i-a.center))**2,0)/axis.length;}
    rms=Math.sqrt(rms);
    const pulsePeaks=peaks(p.power,40/60,200/60,.02),motionPeaks=peaks(motionPower,.5,5,.08).slice(0,8);
    const closeToMotion=f=>motionPeaks.some(m=>Math.abs(m.f-f)<SETTINGS.peak_match_hz);
    const cleanPeaks=pulsePeaks.filter(v=>!closeToMotion(v.f));
    let pulse=cleanPeaks[0]||null,status='no_shared_peaks',targets=[];
    if(rms<SETTINGS.min_motion_rms_m_s2){pulse=pulsePeaks[0]||null;status='quiet';}
    else if(!pulsePeaks.length){status='no_pulse_candidate';}
    else if(previousPulseHz!==null&&closeToMotion(previousPulseHz)&&
        pulsePeaks.some(v=>Math.abs(v.f-previousPulseHz)<.2)){status='overlap_ambiguous';pulse=null;}
    else if(!pulse || (closeToMotion(pulsePeaks[0].f)&&
        Math.abs(pulse.f-2*pulsePeaks[0].f)<.2)){status='overlap_ambiguous';pulse=null;}
    else{
      // Protect the candidate fundamental. Harmonics may overlap motion;
      // this is why reconstructed morphology and beat intervals are unvalidated.
      const protectedAt=f=>Math.abs(f-pulse.f)<.22;
      targets=motionPeaks.filter(m=>!protectedAt(m.f)&&
        peaks(p.power,.5,5,.02).some(v=>Math.abs(v.f-m.f)<SETTINGS.peak_match_hz));
      for(let k=0;k<gains.length;k++)for(const target of targets){
        const distance=Math.abs(frequency(k)-target.f),width=SETTINGS.notch_half_width_hz;
        const transition=Math.max(0,(distance-SETTINGS.notch_flat_width_hz)/(width-SETTINGS.notch_flat_width_hz));
        if(distance<width&&!protectedAt(frequency(k)))
          gains[k]=Math.min(gains[k],1-(1-SETTINGS.minimum_gain)*(.5+.5*Math.cos(Math.PI*transition)));
      }
      if(targets.length)status='filtering';
    }
    // Missing confidence never manufactures a reconstructed pulse.
    const output=ppg.slice();
    if(status==='filtering'){
      for(let k=0;k<p.re.length;k++){const gain=gains[Math.min(k,p.re.length-k)];p.re[k]*=gain;p.im[k]*=gain;}
      fft(p.re,p.im,true);
      for(let i=180;i<300;i++)output[i]=p.re[i]/p.window[i]+p.mean+p.slope*(i-p.center);
    }
    return {output,status,pulse_hz:pulse?.f??null,motion_rms:rms,motion_peaks_hz:motionPeaks.map(v=>v.f),
      suppressed_peaks_hz:targets.map(v=>v.f),frequencies_hz:motionPower.map((_,k)=>frequency(k)),
      ppg_power:p.power,imu_power:motionPower,gains:Array.from(gains)};
  }
  class SpectralFilter{
    constructor(){this.imu=[];this.lastImuTime=null;this.reset();}
    reset(){this.buffer=[];this.accum=new Map();this.segment=null;this.lastTime=null;this.sinceWindow=0;
      this.previousPulse=null;this.previousPulseTime=null;this.status='warming_up';this.lastDiagnostic=null;}
    push(imu){
      for(const row of imu){if(!Number.isFinite(row.time_s)||(this.lastImuTime!==null&&row.time_s<=this.lastImuTime))continue;
        this.lastImuTime=row.time_s;this.imu.push({t:row.time_s,values:FIELDS.map(k=>row[k])});}
      const cutoff=(this.lastImuTime??0)-16;
      while(this.imu.length>2&&this.imu[1].t<cutoff)this.imu.shift();
      if(this.imu.length>3000)this.imu.splice(0,this.imu.length-3000);
    }
    reference(start,end){
      let first=0;while(first+1<this.imu.length&&this.imu[first+1].t<start)first++;
      let last=first;while(last+1<this.imu.length&&this.imu[last].t<end)last++;
      const rows=this.imu.slice(first,last+1);
      if(rows.length<80||rows[0].t-start>SETTINGS.max_edge_hold_s||end-rows.at(-1).t>SETTINGS.max_edge_hold_s)return null;
      if(rows.some((r,i)=>r.values.some(v=>!Number.isFinite(v)||Math.abs(v)>100)||
          (i&&r.t-rows[i-1].t>SETTINGS.max_imu_gap_s)))return null;
      const axes=[[],[],[]];let cursor=0;
      for(let i=0;i<480;i++){
        const t=start+i/60;while(cursor+1<rows.length&&rows[cursor+1].t<t)cursor++;
        const a=rows[cursor],b=rows[Math.min(rows.length-1,cursor+1)],w=b.t>a.t?Math.max(0,Math.min(1,(t-a.t)/(b.t-a.t))):0;
        for(let k=0;k<3;k++)axes[k].push(a.values[k]+w*(b.values[k]-a.values[k]));
      }
      // Isolated sensor spikes are cleaned within each spectral window only.
      return axes.map(axis=>axis.map((v,i)=>{const a=axis.slice(Math.max(0,i-3),Math.min(axis.length,i+4)),m=median(a),mad=median(a.map(x=>Math.abs(x-m)));
        return Math.abs(v-m)>Math.max(.5,6*1.4826*mad)?m:v;}));
    }
    feed(row,availableTime){
      if(!row.ready||!Number.isFinite(row.primary_bvp)){this.reset();this.status='invalid_ppg';return {rows:[],windows:[]};}
      if(this.segment!==row.segment||(this.lastTime!==null&&Math.abs(row.time_s-this.lastTime-1/60)>1e-6))this.reset();
      this.segment=row.segment;this.lastTime=row.time_s;this.buffer.push(row);this.sinceWindow++;
      if(this.buffer.length<480)return {rows:[],windows:[]};
      if(this.buffer.length>480)this.buffer.shift();
      if(this.sinceWindow<60)return {rows:[],windows:[]};this.sinceWindow=0;
      const start=this.buffer[0].time_s,end=this.buffer.at(-1).time_s,axes=this.reference(start,end);
      const prior=this.previousPulseTime!==null&&end-this.previousPulseTime<5?this.previousPulse:null;
      const result=axes?analyzeWindow(this.buffer.map(r=>r.primary_bvp),axes,prior):
        {output:this.buffer.map(r=>r.primary_bvp),status:'missing_imu',pulse_hz:null,motion_rms:null,motion_peaks_hz:[],suppressed_peaks_hz:[]};
      if(result.pulse_hz!==null){this.previousPulse=result.pulse_hz;this.previousPulseTime=end;}
      this.status=result.status;
      const diagnostic={window_start_s:start,window_end_s:end,available_time_s:availableTime,
        status:result.status,pulse_candidate_hz:result.pulse_hz,motion_rms:result.motion_rms,
        motion_peaks_hz:result.motion_peaks_hz,suppressed_peaks_hz:result.suppressed_peaks_hz};
      this.lastDiagnostic=diagnostic;
      const trusted=!['overlap_ambiguous','missing_imu','no_pulse_candidate'].includes(result.status);
      for(let i=180;i<300;i++){
        const source=this.buffer[i],key=source.time_s.toFixed(6),w=.5-.5*Math.cos(2*Math.PI*(i-180)/120);
        const a=this.accum.get(key)||{value:0,weight:0,trusted:true,source,status:result.status};
        a.value+=result.output[i]*w;a.weight+=w;a.trusted&&=trusted;
        if(!trusted)a.status=result.status;
        this.accum.set(key,a);
      }
      const output=[];
      for(let i=180;i<240;i++){
        const source=this.buffer[i],key=source.time_s.toFixed(6),a=this.accum.get(key);this.accum.delete(key);
        const filtered=a.weight>1e-9?a.value/a.weight:source.primary_bvp;
        output.push({...source,filtered_bvp:filtered,spectral_status:a.trusted?result.status:a.status,
          spectral_ready:a.trusted,spectral_available_time_s:availableTime,
          spectral_delay_s:availableTime-source.time_s,motion_removed:source.primary_bvp-filtered});
      }
      return {rows:output,windows:[diagnostic]};
    }
  }
  class Pipeline{
    constructor(enabled=false,{core=defaultCore}={}){this.enabled=enabled;this.primary=new core.PrimaryStream();
      this.hrv=new core.HRVTracker();this.hr=new core.HeartRateTracker();this.filter=new SpectralFilter();}
    feed(t,rgb,imu=[]){
      const rows=this.primary.feed(t,rgb[0],rgb[1]);
      if(!this.enabled)return {rows,hrv:rows.map(row=>this.hrv.feed(row)).filter(Boolean),filteredRows:[],spectralWindows:[],spectralStatus:'disabled'};
      this.filter.push(imu);const filteredRows=[],spectralWindows=[];
      for(const row of rows){
        Object.assign(row,{filtered_bvp:null,spectral_status:'pending',spectral_ready:false,
          spectral_available_time_s:null,spectral_delay_s:null,motion_removed:null,spectral_heart_rate_bpm:null,spectral_heart_rate_status:'collecting'});
        const result=this.filter.feed(row,t);spectralWindows.push(...result.windows);
        for(const item of result.rows){
          const heart=this.hr.feed({...item,primary_bvp:item.filtered_bvp,ready:item.spectral_ready,
            status:item.spectral_ready?item.status:'invalid_signal'});
          filteredRows.push({...item,spectral_heart_rate_bpm:heart.heart_rate_bpm,spectral_heart_rate_status:heart.heart_rate_status});
        }
      }
      return {rows,hrv:[],filteredRows,spectralWindows,spectralStatus:this.filter.status};
    }
  }
  const api={SETTINGS,fft,transform,analyzeWindow,SpectralFilter,Pipeline};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FingerSpectral=api;
})(typeof globalThis!=='undefined'?globalThis:this);
