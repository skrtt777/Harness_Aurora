"""Investor report derived from preserved local experiment summaries; no invented metrics."""
import json, hashlib
from pathlib import Path
from datetime import datetime
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, Color, white
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, Table, TableStyle
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output/pdf'; OUT.mkdir(parents=True,exist_ok=True)
paths=['reports/memory-ab-2026-09-20/summary.json','reports/memory-selective-v1-2026-09-20/summary.json','reports/cycle2-functional-workflows-2026-09-20/results.json','reports/cycle2-functional-workflows-compact-2026-09-20/results.json','reports/cycle1-local-repairs-final/results.json','reports/cycle2-product-smoke.json']
base,selective,repair_old,repair,static,smoke=[json.loads((ROOT/p).read_text(encoding='utf-8-sig')) for p in paths]
B=base['baseline']; M=base['memory']; S=selective['memory']
token_gain=(1-S['tokens']/M['tokens'])*100
repair_gain=(1-repair['tokens']/repair_old['tokens'])*100
manifest={'generatedAt':datetime.now().astimezone().isoformat(),'inputs':{p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in paths},'facts':{'selectiveTokenReductionPct':token_gain,'repairTokenReductionPct':repair_gain,'repairRecovered':repair['recovered'],'repairTotal':repair['total'],'electricityAssumptionBRLPerKWh':1,'pcPowerAssumptionW':300}}
(OUT/'Aurora_metricas_fontes.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
for name,file in [('Aurora','segoeui.ttf'),('AuroraBold','segoeuib.ttf')]:pdfmetrics.registerFont(TTFont(name,'C:/Windows/Fonts/'+file))
W,H=595.276,841.89; L=42; R=W-42; CW=R-L
INK=HexColor('#172638'); MUTED=HexColor('#56677A'); CYAN=HexColor('#008CA9'); PURPLE=HexColor('#6957C5'); GREEN=HexColor('#137F61'); RED=HexColor('#AC4146'); LINE=HexColor('#DCE4EC'); PALE=HexColor('#F0F5FA')
c=canvas.Canvas(str(OUT/'Aurora_Relatorio_Investidores.pdf'),pagesize=(W,H))
c.setTitle('Aurora | Métricas, evolução e próximos marcos');c.setAuthor('Projeto Aurora');c.setSubject('Ensaios locais de desenvolvimento - setembro de 2026')
def fmt(n,d=0):return f'{n:,.{d}f}'.replace(',','_').replace('.',',').replace('_','.')
def para(text,x,y,w=CW,size=10.5,color=INK,bold=False,leading=None):
    st=ParagraphStyle('p',fontName='AuroraBold' if bold else 'Aurora',fontSize=size,leading=leading or size*1.43,textColor=color)
    p=Paragraph(text,st);_,h=p.wrap(w,1000);p.drawOn(c,x,y-h);return y-h
def line(y):c.setStrokeColor(LINE);c.line(L,y,R,y)
def page(n,kicker,title,subtitle):
    c.setFillColor(white);c.rect(0,0,W,H,fill=1,stroke=0)
    c.setFillColor(INK);c.rect(0,H-93,W,93,fill=1,stroke=0)
    c.drawImage(str(ROOT/'frontend/public/brand/aurora-wordmark.png'),L,H-77,width=137,height=57,mask='auto')
    para('RELATÓRIO DE DESENVOLVIMENTO',265,H-28,288,8,HexColor('#A2D8E8'))
    para('Métricas e evidências para investidores',265,H-46,288,10,white)
    para(kicker.upper(),L,H-117,CW,8.5,CYAN,True)
    y=para(title,L,H-140,CW,24,INK,True,28)
    y=para(subtitle,L,y-12,CW,10.5,MUTED)
    c.setFillColor(MUTED);c.setFont('Aurora',8);c.drawString(L,23,'Aurora  |  Base experimental: 20/09/2026  |  Protótipo em validação');c.drawRightString(R,23,f'{n} / 7')
    return y-25
def section(title,y):return para(title,L,y,CW,14,INK,True)-12
def box(title,body,y,color=CYAN):
    h=90;c.setFillColor(PALE);c.roundRect(L,y-h,CW,h,9,fill=1,stroke=0)
    c.setFillColor(color);c.rect(L,y-h,3,h,fill=1,stroke=0)
    para(title,L+16,y-13,CW-32,11,color,True);para(body,L+16,y-35,CW-32,10)
    return y-h-20
def table(headers,rows,y,widths=None):
    widths=widths or [CW/len(headers)]*len(headers)
    st=ParagraphStyle('cell',fontName='Aurora',fontSize=9,leading=12,textColor=INK)
    hd=ParagraphStyle('head',parent=st,fontName='AuroraBold',textColor=white)
    t=Table([[Paragraph(str(v),hd) for v in headers]]+[[Paragraph(str(v),st) for v in row] for row in rows],colWidths=widths,hAlign='LEFT')
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),INK),('ROWBACKGROUNDS',(0,1),(-1,-1),[PALE,white]),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9),('LINEBELOW',(0,-1),(-1,-1),.5,LINE)]))
    _,h=t.wrap(CW,1000);t.drawOn(c,L,y-h);return y-h-18
def bars(rows,y,maximum,unit='',width=CW):
    for name,value,color in rows:
        para(name,L,y,width,10,INK,True);para(fmt(value,1 if unit=='/100' else 0)+(' '+unit if unit else ''),R-105,y,105,10,color,True)
        c.setFillColor(PALE);c.roundRect(L,y-32,width,10,5,fill=1,stroke=0)
        c.setFillColor(color);c.roundRect(L,y-32,max(4,width*value/maximum),10,5,fill=1,stroke=0);y-=58
    return y
def end():c.showPage()

y=page(1,'Visão executiva','Menos desperdício.\nQualidade ainda em construção.','O Aurora busca tornar modelos locais mais úteis com contexto seletivo, testes automáticos e reaproveitamento de conhecimento.')
y=box('O que já foi demonstrado','O executor consegue detectar falhas e bloquear entregas reprovadas. Reparos compactos recuperaram 2 de 4 defeitos controlados com o modelo local 1.5B.',y,GREEN)
y=table(['Indicador','Resultado observado','Leitura correta'],[
 ['Consumo na seleção experimental',f'-{fmt(token_gain,1)}% de tokens','Comparação histórica; a aprovação não aumentou.'],
 ['Reparo funcional compacto',f'-{fmt(repair_gain,1)}% de tokens<br/>2/4 defeitos corrigidos','Quatro casos de desenvolvimento; não é taxa de sucesso geral.'],
 ['Entrega completa no A/B inicial','1/18 sem memória<br/>0/18 com memória','Qualidade insuficiente para prometer autonomia ampla.'],
],y,[151,145,CW-296])
y=section('Tese e estágio do projeto',y)
y=para('A oportunidade é transferir trabalho repetitivo do modelo para o software: organizar etapas, limitar contexto, executar testes e reutilizar resultados. Isso pode reduzir custo por entrega útil. Os ensaios atuais sustentam a instrumentação e alguns reparos, mas ainda não comprovam vantagem ampla de qualidade.',L,y)
y=para('<b>Decisão sugerida:</b> avançar com pilotos de tarefas delimitadas e metas verificáveis. Evitar apresentar redução de tokens como aumento automático de precisão ou retorno financeiro.',L,y-16)
end()

y=page(2,'01 / linha de base','Adicionar memória não bastou.','A primeira bateria comparou exatamente os mesmos pedidos com e sem a biblioteca de 73 memórias, predominantemente sobre jogos.')
y=table(['Métrica do lote','Sem memória','Com memória','Variação'],[
 ['Nota média (0 a 100)',fmt(B['score'],1),fmt(M['score'],1),fmt(M['score']-B['score'],1)+' pontos'],
 ['Entregas aprovadas','1/18 (5,6%)','0/18 (0%)','-5,6 p.p.'],
 ['Tokens, incluindo correções',fmt(B['tokens']),fmt(M['tokens']),'+81,0%'],
 ['Tempo de geração',fmt(B['modelMs']/1000,1)+' s',fmt(M['modelMs']/1000,1)+' s','+36,5%'],
 ['Ciclo completo, somado',fmt(B['wallMs']/1000,1)+' s',fmt(M['wallMs']/1000,1)+' s','+22,6%'],
],y,[177,108,108,CW-393])
y=section('Ganhos e perdas por domínio',y)
y=table(['Domínio','Nota sem','Nota com','Mudança'],[[d,fmt(v['baseline']['score'],1),fmt(v['memory']['score'],1),('+' if v['memory']['score']>=v['baseline']['score'] else '')+fmt(v['memory']['score']-v['baseline']['score'],1)] for d,v in base['domains'].items()],y,[205,99,99,CW-403])
y=para('A memória melhorou 7 dos 18 pares, empatou 1 e piorou 10. Páginas ganharam nota parcial; nenhum pedido desse domínio atingiu aprovação completa. Jogos concentraram a maior perda.',L,y,size=10)
y=para('<b>Incerteza:</b> o intervalo exploratório de 95% para a diferença média vai de -21,3 a +12,1 pontos e inclui zero. A amostra não permite concluir que toda memória ajuda ou atrapalha.',L,y-14,size=10)
y=para('Amostra: 6 tarefas x 3 sementes x 2 condições = 36 execuções. As sementes repetem tarefas; não representam 18 tipos independentes de problema.',L,y-14,size=9,color=MUTED)
end()

y=page(3,'02 / contexto seletivo','Menos tokens, sem avanço de aprovação.','Uma configuração experimental passou a selecionar menos referências e a rejeitar parte do contexto que não combinava com a tarefa.')
y=bars([('Memória na configuração inicial',M['tokens'],PURPLE),('Memória na configuração seletiva',S['tokens'],CYAN)],y,150000,'tokens')
y=box(f'{fmt(token_gain,1)}% menos tokens entre os lotes com memória','135.145 para 90.354 tokens. Porém, a nota média foi de 32,2 para 30,6, e ambos os lotes tiveram zero entregas aprovadas em 18 pedidos.',y,PURPLE)
y=table(['No novo ensaio','Sem memória','Com memória seletiva'],[
 ['Tokens totais',fmt(selective['baseline']['tokens']),fmt(S['tokens'])],
 ['Nota média / 100',fmt(selective['baseline']['score'],1),fmt(S['score'],1)],
 ['Aprovações','0/18','0/18'],
],y,[225,143,CW-368])
y=para('<b>Decisão tomada:</b> a seleção candidata não foi promovida a padrão. Economizar texto processado sem aumentar entregas funcionais não atende ao objetivo do produto.',L,y)
y=para('Comparar os lotes antigos e novos mistura alterações de seleção de skills e de memória; não isola o efeito causal da memória. Houve 9 pares com pedidos iniciais idênticos e 4 deles geraram saídas diferentes apesar da mesma semente. Tempos deste ciclo também coincidiram com outros testes do sistema.',L,y-16,size=9.5,color=MUTED)
end()

y=page(4,'03 / reparos e precisão','Testar antes de aceitar uma correção.','Defeitos conhecidos foram inseridos em pequenos arquivos HTML. O executor testou as propostas do modelo e manteve o bloqueio quando a falha persistiu.')
y=table(['Caso controlado','Recuperado?','Chamadas reais','Tokens'],[[{'restart':'Reinício do contador','persistence':'Persistência de tarefas','filters':'Filtros combinados','calculations':'Margem do BI'}[r['id']],'Sim' if r['passed'] else 'Não',str(r['realCalls']),fmt(r['usage']['input']+r['usage']['output'])] for r in repair['records']],y,[195,96,111,CW-402])
y=box('2 de 4 defeitos corrigidos (50%)',f"O reparo compacto usou {repair['realCalls']} chamadas e {fmt(repair['tokens'])} tokens. A configuração anterior usou {repair_old['realCalls']} chamadas e {fmt(repair_old['tokens'])} tokens, sem recuperar casos. Redução de {fmt(repair_gain,1)}% nesta amostra.",y,GREEN)
y=section('O que significa “precisão” aqui?',y)
y=para('<b>Aprovação:</b> proporção de entregas que cumprem todos os testes exigidos. <b>Nota:</b> atendimento parcial aos critérios. <b>Recuperação:</b> defeitos inicialmente presentes que foram corrigidos. Esses números não são intercambiáveis.',L,y)
y=para('Em um ensaio separado de sintaxe/DOM, 3 de 3 defeitos foram recuperados (4 chamadas, 1.256 tokens). Isso não pode ser somado aos quatro casos funcionais como uma taxa geral de capacidade.',L,y-14,size=10)
y=para('<b>Geração natural:</b> um contador feito pela interface consumiu 3.397 tokens em duas chamadas e ficou reprovado por exibir “2.00” onde o contrato exigia “2”; a edição não coincidiu com o alvo. É uma falha de conformidade e reparo, não prova de erro aritmético.',L,y-14,size=10)
y=para('Os quatro casos orientaram o ajuste do prompt; são desenvolvimento, não avaliação inédita. Nenhuma intervenção humana corrigiu os arquivos dentro das medições.',L,y-14,size=9,color=MUTED)
end()

y=page(5,'04 / custo e desempenho','Energia barata não resolve baixa aprovação.','O custo relevante é o custo total por entrega útil: computação, equipamento, tempo humano, manutenção e eventual ajuda de outros modelos.')
y=table(['A/B inicial','Sem memória','Com memória'],[
 ['Energia GPU amostrada',fmt(B['gpuWh'],3)+' Wh',fmt(M['gpuWh'],3)+' Wh'],
 ['Energia do PC simulada / lote','R$ '+fmt(B['wallMs']/3600000*.3,4),'R$ '+fmt(M['wallMs']/3600000*.3,4)],
 ['Simulação para 1.000 pedidos','R$ '+fmt(B['wallMs']/3600000*.3/18*1000,2),'R$ '+fmt(M['wallMs']/3600000*.3/18*1000,2)],
 ['Energia simulada / aprovação','R$ '+fmt(B['wallMs']/3600000*.3,4),'Não calculável: 0 aprovações'],
 ['P50 do ciclo por pedido',fmt(B['wallP50']/1000,1)+' s',fmt(M['wallP50']/1000,1)+' s'],
 ['P95 do ciclo por pedido',fmt(B['wallP95']/1000,1)+' s',fmt(M['wallP95']/1000,1)+' s'],
],y,[217,146,CW-363])
y=box('Hipóteses editáveis, não conta de energia medida','Simulação: PC a 300 W e tarifa de R$ 1,00/kWh, escolhida como hipótese pelo usuário. Fórmula: horas do ciclo x 0,3 kW x tarifa. Hardware e trabalho humano não estão incluídos.',y,PURPLE)
y=para('<b>APIs pagas:</b> R$ 0,00 durante a bateria local. Isso não significa custo total zero. A GPU foi amostrada por nvidia-smi e inclui outros processos; não mede a tomada nem todo o computador.',L,y,size=10)
y=para('<b>Máquina do ensaio:</b> Intel i9-14900K, 31,8 GB de RAM e RTX 4090. Modelo qwen2.5-coder:1.5b Q4_K_M, Ollama 0.34.2. A velocidade observada não demonstra desempenho em um computador modesto.',L,y-14,size=10)
y=para('Não foi calculado ROI nem economia frente a um provedor comercial: faltam preços efetivos, equivalência de qualidade, utilização do equipamento e custos operacionais completos.',L,y-14,size=9.5,color=MUTED)
end()

y=page(6,'05 / marcos de evolução','Transformar o protótipo em evidência de produto.','Próximas decisões devem ser tomadas por desempenho em tarefas novas, com orçamento fixo e critérios definidos antes de executar os modelos.')
y=table(['Marco','Critério de saída proposto'],[
 ['1. Correções confiáveis','Resolver filtros e cálculos; preservar testes que já passam e rejeitar edições sem progresso.'],
 ['2. Avaliação inédita','Congelar configuração e executar 12 tarefas novas (3 por domínio), com 3 sementes e orçamento igual.'],
 ['3. Entregas funcionais','Meta inicial de pelo menos 50% na suíte simples suportada; 80% é objetivo posterior, ainda não atingido.'],
 ['4. Comparação de modelos','Medir 1.5B e 3B já disponíveis com o mesmo executor; avaliar tempo e custo por aprovação, não apenas tokens.'],
 ['5. Conhecimento verificado','Promover memórias de correção somente com teste antes/depois; comprovar transferência para casos novos.'],
 ['6. Piloto em hardware-alvo','Repetir em máquina acessível e contabilizar energia total, memória, equipamento e revisão humana.'],
],y,[165,CW-165])
y=section('Skills sob demanda: escala de catálogo, não de contexto',y)
y=para('O índice do Hermes consultado possui 98.326 entradas de seis fontes. A proposta é pesquisar metadados e importar apenas a skill escolhida. Uma biblioteca maior não significa que cada skill foi testada, que suas ferramentas estão instaladas ou que o modelo ficou mais preciso.',L,y)
y=para('O acervo não é enviado integralmente ao modelo. A unidade econômica é o conhecimento pertinente à tarefa, com procedência, revisão e verificação de resultado.',L,y-14,size=10)
y=para('Não há neste relatório validação de mercado, receita, retenção, tamanho de mercado ou compromisso de retorno. O foco é maturidade técnica e qualidade das evidências.',L,y-17,size=9.5,color=MUTED)
end()

y=page(7,'06 / método e fontes','Como ler e reproduzir os números.','As métricas vêm de arquivos preservados no projeto Aurora. Não há pontuações geradas para fins de apresentação.')
y=section('Método do A/B inicial',y)
y=para('Seis tarefas pequenas: alvo, quiz, landing page, catálogo, lista persistente e BI. Sementes 17, 41 e 73; temperatura 0,2; contexto de 8.192 tokens; saída de até 2.048 tokens; uma correção permitida. A ordem dos braços foi balanceada. Nenhuma nova memória foi aprendida durante a bateria.',L,y,size=10)
y=para('Nota: funcionalidade 70 pontos, estrutura 10, controles/rótulos 10, layout sem overflow 5 e execução 5. Aprovação: todos os requisitos funcionais e de execução, mais nota mínima de 90. Não é nota estética nem auditoria completa de acessibilidade.',L,y-13,size=10)
y=para('O avaliador foi conferido com seis referências corretas e defeitos intencionais. O A/B usa contexto real do Aurora, mas um ciclo de correção controlado distinto do chat. Os reparos funcionais posteriores usam o executor de etapas do produto.',L,y-13,size=10)
y=section('Trilha de evidências no repositório',y-20)
sources=[('A/B inicial','reports/memory-ab-2026-09-20/summary.json'),('Seleção experimental','reports/memory-selective-v1-2026-09-20/summary.json'),('Reparo funcional: configuração inicial','reports/cycle2-functional-workflows-2026-09-20/results.json'),('Reparo funcional: configuração compacta','reports/cycle2-functional-workflows-compact-2026-09-20/results.json'),('Defeitos estáticos / DOM','reports/cycle1-local-repairs-final/results.json'),('Geração natural pela interface','reports/cycle2-product-smoke.json')]
for title,path in sources:
    y=para(title,L,y,CW,9,INK,True);y=para(path,L,y-3,CW,8,MUTED)-11
y=para('O arquivo Aurora_metricas_fontes.json acompanha o PDF com hashes SHA-256 dos dados de origem e as hipóteses de cálculo. Prompts, respostas, HTML e validações detalhadas estão nas pastas de cada ensaio.',L,y,size=9)
y=para('Fonte do catálogo: <link href="https://hermes-agent.nousresearch.com/docs/skills" color="#008CA9">Hermes Skills Hub</link>. Índice JSON: /docs/api/skills-index.json, versão 1, gerado em 20/09/2026. Contagens podem mudar; o número citado é o consultado para este relatório.',L,y-12,size=9)
end();c.save()
print(OUT/'Aurora_Relatorio_Investidores.pdf')
