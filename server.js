import express from 'express';
import { neon } from '@neondatabase/serverless';

const app = express();
app.use(express.json());
app.use(express.static('public'));

function db(){
  if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  return neon(process.env.DATABASE_URL);
}

function cleanUserCode(v){
  const s=String(v||'').trim();
  return /^[A-Za-z0-9_-]{3,80}$/.test(s)?s:null;
}
function num(v){ const n=Number(v); return Number.isFinite(n)?n:null; }

app.get('/health',(req,res)=>res.json({ok:true,service:'MUVVHIMII Aviator Analysis Engine',version:'engine-v1'}));

app.get('/api/rounds', async (req,res)=>{
  try{
    const limit=Math.min(Math.max(parseInt(req.query.limit||'100',10)||100,1),500);
    const rows=await db()`SELECT id, round_code, multiplier, observed_at, source FROM public.aviator_rounds ORDER BY observed_at DESC LIMIT ${limit}`;
    res.json({ok:true,rounds:rows});
  }catch(e){res.status(500).json({ok:false,error:e.message});}
});

app.post('/api/rounds', async (req,res)=>{
  try{
    const multiplier=num(req.body.multiplier);
    if(multiplier===null || multiplier<=0 || multiplier>100000) return res.status(400).json({ok:false,error:'Enter a valid multiplier greater than 0.'});
    const roundCode=String(req.body.round_code||'').trim().slice(0,120)||null;
    const source=String(req.body.source||'user').trim().slice(0,80)||'user';
    const rows=await db()`INSERT INTO public.aviator_rounds(round_code,multiplier,source) VALUES(${roundCode},${multiplier.toFixed(2)},${source}) RETURNING id,round_code,multiplier,observed_at,source`;
    res.json({ok:true,round:rows[0]});
  }catch(e){res.status(500).json({ok:false,error:e.message});}
});

// Transparent empirical baseline. It does not claim to predict an independent random next round.
app.post('/api/analysis', async (req,res)=>{
  try{
    const requested=Math.min(Math.max(parseInt(req.body.window||'100',10)||100,20),500);
    const rows=await db()`SELECT id,multiplier,observed_at FROM public.aviator_rounds ORDER BY observed_at DESC LIMIT ${requested}`;
    const vals=rows.map(r=>Number(r.multiplier)).filter(Number.isFinite).reverse();
    const n=vals.length;
    if(n<20){
      return res.json({ok:true,model_version:'baseline-v1',status:'insufficient_confidence',sample_size:n,message:`Need at least 20 stored rounds; currently have ${n}.`,analysis:null,predictions:null});
    }
    const sorted=[...vals].sort((a,b)=>a-b);
    const q=p=>{const x=(sorted.length-1)*p;const lo=Math.floor(x),hi=Math.ceil(x);return lo===hi?sorted[lo]:sorted[lo]+(sorted[hi]-sorted[lo])*(x-lo)};
    const mean=vals.reduce((a,b)=>a+b,0)/n;
    const variance=vals.reduce((a,b)=>a+(b-mean)**2,0)/n;
    const sd=Math.sqrt(variance);
    const median=q(.5), p25=q(.25), p75=q(.75), p10=q(.10), p90=q(.90);
    const low=vals.filter(x=>x<2).length/n*100, high=vals.filter(x=>x>=5).length/n*100;
    const cv=mean?sd/mean:0;
    // These are distribution buckets, not probabilities of the next independent round.
    const conservativeMin=Math.max(1,p25);
    const conservativeMax=Math.max(conservativeMin,median);
    const higherMin=Math.max(median,p75);
    const higherMax=Math.max(higherMin,p90);
    const quality=Math.max(0,Math.min(100,40 + Math.min(30,n/3) + (cv<1.5?15:cv<2.5?8:0) + (n>=50?15:0)));
    const features={sample_size:n,mean,median,p10,p25,p75,p90,standard_deviation:sd,coefficient_of_variation:cv,under_2_pct:low,at_least_5_pct:high,method:'empirical-quantiles'};
    const inserted=await db()`INSERT INTO public.aviator_predictions(prediction_type,predicted_value,predicted_min,predicted_max,confidence,model_version,features,status) VALUES('range','empirical quantile ranges',${conservativeMin.toFixed(2)},${conservativeMax.toFixed(2)},${quality.toFixed(2)},'baseline-v1',${JSON.stringify(features)}::jsonb,'pending') RETURNING id,created_at,model_version,confidence,predicted_min,predicted_max`;
    res.json({ok:true,model_version:'baseline-v1',status:'ready',sample_size:n,analysis:{mean,median,p25,p75,p10,p90,standard_deviation:sd,coefficient_of_variation:cv,under_2_pct:low,at_least_5_pct:high,data_quality:quality},predictions:{conservative:{min:conservativeMin,max:conservativeMax,classification:'Lower analytical risk bucket'},higher_risk:{min:higherMin,max:higherMax,classification:'Higher analytical risk bucket'}},prediction_id:inserted[0].id,disclaimer:'These empirical ranges describe the stored sample. They are not guaranteed outcomes and should not be interpreted as a probability that the next round will land in a range.'});
  }catch(e){res.status(500).json({ok:false,error:e.message});}
});

app.post('/api/feedback', async (req,res)=>{
  try{
    const predictionId=String(req.body.prediction_id||'').trim();
    const outcome=req.body.outcome;
    const actual=num(req.body.actual_multiplier);
    if(!predictionId || !['success','fail'].includes(outcome)) return res.status(400).json({ok:false,error:'prediction_id and outcome (success/fail) are required.'});
    const p=await db()`SELECT id,predicted_min,predicted_max FROM public.aviator_predictions WHERE id=${predictionId} LIMIT 1`;
    if(!p.length) return res.status(404).json({ok:false,error:'Prediction not found.'});
    const userCode=cleanUserCode(req.body.user_code);
    let userId=null;
    if(userCode){ const u=await db()`SELECT id FROM public.app_users WHERE user_code=${userCode} LIMIT 1`; if(u.length) userId=u[0].id; }
    await db()`INSERT INTO public.aviator_prediction_feedback(prediction_id,user_id,outcome,actual_multiplier) VALUES(${predictionId},${userId},${outcome},${actual})`;
    await db()`UPDATE public.aviator_predictions SET status=${outcome},resolved_at=now() WHERE id=${predictionId}`;
    res.json({ok:true});
  }catch(e){res.status(500).json({ok:false,error:e.message});}
});

app.get('/api/performance', async (req,res)=>{
  try{
    const rows=await db()`SELECT COUNT(*)::int AS total, COUNT(*) FILTER(WHERE outcome='success')::int AS success, COUNT(*) FILTER(WHERE outcome='fail')::int AS fail FROM public.aviator_prediction_feedback`;
    const r=rows[0]; const rate=r.total?Number(r.success)/Number(r.total)*100:null;
    res.json({ok:true,total:r.total,success:r.success,fail:r.fail,success_rate:rate});
  }catch(e){res.status(500).json({ok:false,error:e.message});}
});

app.get('*',(req,res)=>res.sendFile(process.cwd()+'/public/index.html'));
const port=process.env.PORT||3000;
app.listen(port,'0.0.0.0',()=>console.log(`MUVVHIMII engine listening on ${port}`));
