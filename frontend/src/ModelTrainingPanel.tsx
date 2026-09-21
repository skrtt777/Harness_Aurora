import {useEffect,useState} from 'react';
import {getModelExperiment,type ModelExperiment} from './api';
export default function ModelTrainingPanel(){
 const [experiment,setExperiment]=useState<ModelExperiment|null>(null);
 useEffect(()=>{let active=true;getModelExperiment().then(x=>{if(active)setExperiment(x);}).catch(()=>{});return()=>{active=false;};},[]);
 if(!experiment)return null;
 const e=experiment,d=e.decision,n=(x:number)=>x.toLocaleString('pt-BR',{maximumFractionDigits:1});
 return <details className="engine-panel"><summary>Treinamento local · {d.passed?'critérios atingidos':'experimental'}</summary>
 <p>{e.model} · {(e.training.trainableParameters/1e6).toFixed(1)} milhões de parâmetros ajustados · {e.training.examples} exemplos de treino.</p>
 <p><strong>{d.reason}</strong></p><div className="engine-table"><table><thead><tr><th>Versão</th><th>Cenários aprovados</th><th>Tokens</th></tr></thead><tbody><tr><td>Original</td><td>{d.baseline.passed}/{d.baseline.total}</td><td>{n(d.baseline.tokens)}</td></tr><tr><td>Treinada</td><td>{d.candidate.passed}/{d.candidate.total}</td><td>{n(d.candidate.tokens)}</td></tr></tbody></table></div>
 <p>Diferença: {n(d.gainPoints)} pontos percentuais. Aprovação vale para os cenários testados, não para precisão geral.</p>
 <ul>{d.checks.map(c=><li key={c.name}>{c.passed?'✓':'✗'} {c.name}</li>)}</ul>
 {e.limitations.map(l=><p key={l}><small>{l}</small></p>)}
 </details>;
}
