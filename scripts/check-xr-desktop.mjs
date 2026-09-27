import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const state=JSON.parse(readFileSync(join(process.env.APPDATA,'Harness Aurora XR/state.json'),'utf8'));
const memories=Object.values(state.operations).filter(op=>op.kind==='memory'&&op.state==='complete');
const memory=memories.at(-1)?.result;
if(!memory)throw new Error('O Quest ainda não concluiu uma gravação de memória.');
const base='http://127.0.0.1:8787';const {token}=await (await fetch(base+'/api/session')).json();
const headers={'x-harness-token':token};
const conversation=await (await fetch(base+'/api/conversations/'+memory.conversationId,{headers})).json();
const {memories:stored}=await (await fetch(base+'/api/memories?conversationId='+memory.conversationId,{headers})).json();
if(!stored.some(m=>m.id===memory.id&&m.content===memory.content))throw new Error('Memória do Quest não confere com o Harness.');
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto(base,{waitUntil:'networkidle'});
  await page.getByRole('button',{name:conversation.title,exact:true}).first().click();
  const message=conversation.messages.find(m=>m.role==='user'&&m.content.startsWith('Teste de persistência de memória do Quest.'));
  if(!message)throw new Error('Mensagem de validação não encontrada.');
  await page.getByText(message.content,{exact:true}).first().waitFor({state:'visible',timeout:15000});
  await page.screenshot({path:'unreal/AuroraXR/Saved/PresenceDesktop.png',fullPage:true});
  const report={at:new Date().toISOString(),conversationId:conversation.id,memoryId:memory.id,nativeMessageVisibleOnDesktop:true,memoryContentMatches:true};
  writeFileSync('unreal/AuroraXR/Saved/PresenceDesktopValidation.json',JSON.stringify(report,null,2));
  console.log('Mensagem enviada no Quest visível na interface do Harness; memória com mesmo ID e conteúdo.');
}finally{await browser.close();}
