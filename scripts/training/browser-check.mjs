import {chromium} from 'playwright';
import {existsSync} from 'node:fs';
import {runFunctionalCases,functionalEvidence} from '../../app/functionalTests.js';
import {diagnoseLocalArtifact,diagnosticText} from '../../app/localDiagnostics.js';
export async function browserChecker(){
 const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
 const browser=await chromium.launch({headless:true,...(existsSync(edge)?{executablePath:edge}:{})});
 return {close:()=>browser.close(),check:async(t)=>{
   const diagnostics=diagnoseLocalArtifact(t.reference);
   if(diagnostics.issues.length)return {status:'failed',evidence:[diagnosticText(diagnostics)],diagnostics};
   const functional=await runFunctionalCases(browser,t.reference,t.contract);
   return {status:functional.passedCases.length===functional.totalCases?'passed':'failed',evidence:functionalEvidence(functional.results),functional};
 }};
}
