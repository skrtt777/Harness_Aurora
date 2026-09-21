"""Measured update: development fixtures and frozen evaluation are separate."""
import json,hashlib
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor,white
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph,Table,TableStyle
from reportlab.lib.styles import ParagraphStyle
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output/pdf';OUT.mkdir(parents=True,exist_ok=True)
source=ROOT/'reports/engine-evaluation-v1/summary.json'
d=json.loads(source.read_text(encoding='utf8'));arms=d['arms'];base=arms[0]
old=json.loads((ROOT/'reports/cycle2-functional-workflows-compact-2026-09-20/results.json').read_text(encoding='utf8'))
dev=json.loads((ROOT/'reports/engine-development-v2/results.json').read_text(encoding='utf8'))
for name,file in [('Aurora','segoeui.ttf'),('AuroraBold','segoeuib.ttf')]:pdfmetrics.registerFont(TTFont(name,'C:/Windows/Fonts/'+file))
W,H=595.276,841.89;L=42;R=W-42;CW=R-L
INK=HexColor('#172638');MUTED=HexColor('#56677A');CYAN=HexColor('#008CA9');PURPLE=HexColor('#6957C5');GREEN=HexColor('#137F61');PALE=HexColor('#F0F5FA');LINE=HexColor('#DCE4EC')
c=canvas.Canvas(str(OUT/'Aurora_Relatorio_Investidores_Engine.pdf'),pagesize=(W,H))
c.setTitle('Aurora | Engine de Evidências - avaliação medida');c.setAuthor('Projeto Aurora')
def fmt(n,places=0):return f'{n:,.{places}f}'.replace(',','_').replace('.',',').replace('_','.')
def para(text,y,size=10.5,color=INK,bold=False,x=L,w=CW):
    style=ParagraphStyle('p',fontName='AuroraBold' if bold else 'Aurora',fontSize=size,leading=size*1.42,textColor=color)
    p=Paragraph(text,style);_,height=p.wrap(w,1200);p.drawOn(c,x,y-height);return y-height
def page(n,kicker,title,subtitle):
    c.setFillColor(INK);c.rect(0,H-93,W,93,fill=1,stroke=0);c.drawImage(str(ROOT/'frontend/public/brand/aurora-wordmark.png'),L,H-77,width=137,height=57,mask='auto')
    para('RELATÓRIO DE DESENVOLVIMENTO',H-27,8,HexColor('#A2D8E8'),x=265,w=285);para('Engine de Evidências | Atualização medida',H-45,10,white,x=265,w=285)
    para(kicker.upper(),H-117,8.5,CYAN,True);y=para(title,H-140,24,INK,True);y=para(subtitle,y-12,10.5,MUTED)
    c.setFillColor(MUTED);c.setFont('Aurora',8);c.drawString(L,23,'Aurora | Avaliação de desenvolvimento, setembro/2026 | Protótipo');c.drawRightString(R,23,f'{n} / 5')
    return y-25
def section(title,y):return para(title,y,14,INK,True)-12
def table(headers,rows,y,widths):
    style=ParagraphStyle('cell',fontName='Aurora',fontSize=9,leading=12,textColor=INK);head=ParagraphStyle('head',parent=style,fontName='AuroraBold',textColor=white)
    t=Table([[Paragraph(str(v),head) for v in headers]]+[[Paragraph(str(v),style) for v in row] for row in rows],colWidths=widths)
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),INK),('ROWBACKGROUNDS',(0,1),(-1,-1),[PALE,white]),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9),('LINEBELOW',(0,-1),(-1,-1),.5,LINE)]))
    _,height=t.wrap(CW,1200);t.drawOn(c,L,y-height);return y-height-20
def note(title,body,y):
    y=para(title,y,11,PURPLE,True);return para(body,y-7,10)-22
def end():c.showPage()
def per(a,k):return a[k]/a['passed'] if a['passed'] else None
def cost(a):return a['elapsedMs']/3600000*.3

y=page(1,'Visão executiva','Transferir trabalho da IA para software verificável.','A nova engine propõe reparos limitados, testa alterações e registra conhecimento com evidências. Seu desempenho foi separado do efeito de adicionar memória.')
y=table(['O que foi medido','Resultado','O que significa'],[
['Quatro defeitos conhecidos',f"{dev['recovered']}/{dev['total']} reparados; {dev['realCalls']} chamadas ao modelo",'Hipóteses determinísticas aprovadas nos contratos. Casos de desenvolvimento, com entrada sintética.'],
['Tarefas novas',f"{d['taskCount']} tarefas × {len(d['seeds'])} sementes × 3 grupos",'108 gerações e suas tentativas de correção, com modelo local real e orçamento igual.'],
['Sem conhecimento adicional',f"{base['passed']}/{base['runs']} aprovados ({fmt(100*base['passed']/base['runs'],1)}%)",'Aprovação nos contratos fornecidos; não mede todos os requisitos de projetos reais.'],
],y,[145,146,CW-291])
y=section('Resultado central',y)
for a in arms[1:]:
    change=100*(a['passed']/a['runs']-base['passed']/base['runs']);tokenchange=(a['tokens']/base['tokens']-1)*100
    y=para(f"<b>{a['name']}:</b> {a['passed']}/{a['runs']} aprovados; diferença de {fmt(change,1)} pontos percentuais e {fmt(abs(tokenchange),1)}% {'mais' if tokenchange>=0 else 'menos'} tokens frente ao grupo sem conhecimento.",y)-14
y=para('Após a avaliação, o contexto mínimo passou a ser o padrão das execuções por etapas. Memórias e skills podem ser incluídas explicitamente; os resultados não justificaram sua inclusão automática como melhoria geral.',y,10,MUTED)-18
y=note('Leitura para investidores','Há um componente técnico funcional e evidências auditáveis. Um catálogo grande não comprova ganho de qualidade. O investimento em evolução deve ser guiado por entregas corretas e custo por aprovação, com pilotos delimitados.',y)
end()

y=page(2,'01 / comparação controlada','Quanto trabalho correto foi entregue?','Modelo qwen2.5-coder:1.5b, temperatura 0,2, sementes 17, 41 e 73. Todos os grupos receberam a mesma engine, os mesmos pedidos e contratos.')
for a,color in zip(arms,[CYAN,PURPLE,GREEN]):
    y=para(a['name'],y,11,INK,True);y=para(f"{a['passed']}/{a['runs']} aprovados - {fmt(a['passed']/a['runs']*100,1)}%",y-4,10,color)
    c.setFillColor(PALE);c.roundRect(L,y-20,CW,9,4,fill=1,stroke=0);c.setFillColor(color)
    if a['passed']:c.roundRect(L,y-20,CW*a['passed']/a['runs'],9,4,fill=1,stroke=0)
    y-=43
y=table(['Grupo','Tokens totais','Tokens / aprovado','Tempo / aprovado'],[[a['name'],fmt(a['tokens']),fmt(per(a,'tokens')) if a['passed'] and a['completeUsage'] else 'Indisponível',fmt(per(a,'elapsedMs')/1000,1)+' s' if a['passed'] else 'Indisponível'] for a in arms],y,[145,100,131,CW-376])
y=para('O numerador inclui as tentativas reprovadas. Os tempos incluem geração, validação e reparo. Uma entrega que passa continua aguardando aceite humano no produto.',y,10,MUTED)-20
y=section('O que mudou entre os grupos',y)
y=para('<b>Sem conhecimento:</b> sem memórias e sem skills no contexto. <b>Com memórias:</b> quatro lições derivadas dos defeitos de desenvolvimento, selecionadas por pertinência. <b>Memórias + skills:</b> as mesmas memórias, skills locais e os procedimentos aprendidos ativados apenas no projeto isolado.',y)-16
y=para('Nenhuma correção das tarefas novas foi ativada durante a campanha. As referências manuais usadas para conferir os testes não foram enviadas ao modelo.',y,10,MUTED)
end()

y=page(3,'02 / qualidade e incerteza','O resultado depende do tipo de tarefa.','Três tarefas por domínio e três sementes por tarefa. Os testes verificam interações, estado, persistência, filtros e cálculos especificados.')
y=table(['Domínio','Sem conhecimento','Com memórias','Memórias + skills'],[[{'jogo':'Jogo','pagina':'Página','app':'App','bi':'BI'}[domain]]+[f"{a['domains'][domain]['passed']}/{a['domains'][domain]['runs']}" for a in arms] for domain in base['domains']],y,[110,133,133,CW-376])
y=section('Diferença frente ao grupo sem conhecimento',y)
for comp in d['comparisons']:
    name=next(a['name'] for a in arms if a['id']==comp['arm']);lo,hi=comp['clusterBootstrap95']
    y=para(f"<b>{name}:</b> {fmt(comp['deltaPercentagePoints'],1)} pontos percentuais; intervalo de 95%: {fmt(lo,1)} a {fmt(hi,1)} p.p.",y)-14
y=para('Intervalos estimados por reamostragem de 12 tarefas, mantendo as sementes agrupadas. Se o intervalo inclui zero, o ensaio não estabelece uma diferença clara por esse critério. A amostra é pequena e não representa qualquer pedido possível.',y,10,MUTED)-22
y=note('Esta taxa não é uma precisão geral','Passar significa satisfazer os contratos desta bateria. Aparência, acessibilidade completa, segurança de um produto publicado, integrações externas e cobertura de requisitos não testados não foram certificados.',y)
y=note('Não comparar diretamente com o A/B antigo','A bateria anterior usava outras tarefas, outro acervo e outro fluxo. Os percentuais antigos não são uma linha de base causal para os percentuais desta página.',y)
end()

y=page(4,'03 / ferramenta construída','Uma engine que propõe, testa e registra.','A camada de software reduz a dependência de o modelo acertar cada operação. Ela não altera os pesos da IA local e não transforma toda skill em uma ferramenta executável.')
y=table(['Capacidade','Comportamento implementado'],[
['Compatibilidade','Bloqueia requisitos declarados de plataforma, ferramentas ou ambiente ausentes. Dependências não declaradas continuam exigindo revisão.'],
['Referências sob demanda','Índice curto; até duas consultas por etapa. Conteúdo remoto fixado por revisão pode ser reutilizado do cache. Chamadas continuam no orçamento.'],
['Reparo determinístico','Até seis hipóteses limitadas por etapa. Testes originais decidem a aceitação. Falhas e regressões permanecem bloqueadas.'],
['Edição por alvo','IDs ligados ao hash e à posição no código, como fallback quando a cópia literal falha. Recusa ambiguidade e sobreposição.'],
['Aprendizado','Registra antes/depois de reparos funcionais aprovados. Deduplica evidências iguais e restringe o uso à conversa ou projeto após ativação.'],
],y,[140,CW-140])
y=section('Evolução nos quatro defeitos conhecidos',y)
y=table(['Configuração','Recuperados','Chamadas IA','Tokens'],[['Reparo compacto anterior',f"{old['recovered']}/{old['total']}",str(old['realCalls']),fmt(old['tokens'])],['IDs como padrão (descartado)','0/4','8','8.602'],['Hipóteses determinísticas',f"{dev['recovered']}/{dev['total']}",str(dev['realCalls']),fmt(dev['tokens'])]],y,[210,90,100,CW-400])
y=para('O HTML inicial tem defeitos sintéticos fornecidos ao executor. Zero tokens refere-se somente ao reparo desses quatro casos. Testar custa tempo e computação; esse resultado não é uma economia percentual para qualquer projeto.',y,10,MUTED)
y=para('Na bateria nova, essas hipóteses não se aplicaram e os reparos da IA não recuperaram falhas iniciais. A cobertura dos reparos ainda precisa crescer.',y-12,10,PURPLE)
end()

y=page(5,'04 / custos e rastreabilidade','Custo por aprovação, com hipóteses explícitas.','Energia simulada durante os ciclos: PC a 300 W e tarifa de R$ 1,00/kWh. Os dois valores são editáveis no dashboard.')
y=table(['Grupo','Energia / lote','Energia / aprovado','Chamadas de reparo'],[[a['name'],'R$ '+fmt(cost(a),4),'R$ '+fmt(cost(a)/a['passed'],4) if a['passed'] else 'Indisponível',str(a['repairCalls'])] for a in arms],y,[150,116,129,CW-395])
y=para('Fórmula: horas de ciclo × 0,3 kW × R$ 1,00/kWh. Não houve medição da tomada. Não inclui hardware, ociosidade, manutenção ou trabalho humano. Não foi calculado retorno financeiro nem comparação de preço com APIs comerciais.',y,10,MUTED)-20
y=section('Método reproduzível',y)
y=para('Contratos e configuração foram congelados antes das saídas novas. As referências manuais passaram no validador. A ordem dos grupos foi alternada; o modelo foi aquecido uma vez. O manifesto registra tarefas, sementes, limites e hashes dos fontes. Prompts, respostas, artefatos e evidências foram preservados.',y)-14
y=para('A máquina de desenvolvimento possui RTX 4090. Usar um modelo 1,5B não demonstra o mesmo desempenho em um computador modesto. A próxima validação deve incluir o hardware do público-alvo e tarefas definidas por avaliadores independentes.',y)-22
y=section('Fontes no repositório',y)
for path in ['reports/engine-evaluation-v1/manifest.json','reports/engine-evaluation-v1/summary.json','reports/engine-evaluation-v1/results.json','reports/engine-evaluation-v1/reference-checks.json','reports/engine-development-v2/results.json','docs/ENGINE_DE_EVIDENCIAS.md']:
    y=para(path,y,9,MUTED)-6
end();c.save()
paths=[source,ROOT/'reports/engine-evaluation-v1/manifest.json',ROOT/'reports/engine-evaluation-v1/results.json',ROOT/'reports/engine-development-v2/results.json']
(OUT/'Aurora_Engine_fontes.json').write_text(json.dumps({'sourceHashes':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths},'energyAssumptions':{'watts':300,'tariffBRL':1},'evaluation':d['id']},indent=2),encoding='utf8')
print(OUT/'Aurora_Relatorio_Investidores_Engine.pdf')
