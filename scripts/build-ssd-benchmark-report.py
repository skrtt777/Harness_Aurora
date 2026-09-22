"""Build a measured, bounded investor report from the completed SSD experiment."""
import json
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, Table, TableStyle
from reportlab.lib.styles import ParagraphStyle

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'reports/ssd-moe-v1/dashboard-data.json'
d = json.loads(SOURCE.read_text(encoding='utf8'))
if not d['complete']:
    raise SystemExit('Campanha incompleta: o PDF final só pode ser gerado após todos os perfis.')
profiles = d['profiles']
quality = {q['arm']: q for q in d['quality']}
assert all(p['done'] == 24 and p['complete'] for p in profiles)
assert all(q['done'] == 24 and q['reviewPassed'] is not None for q in quality.values())
OUT = ROOT / 'output/pdf/Aurora_Qwen3_MoE_RAM_SSD.pdf'
OUT.parent.mkdir(parents=True, exist_ok=True)
for name, font in [('Aurora', 'segoeui.ttf'), ('AuroraBold', 'segoeuib.ttf')]:
    pdfmetrics.registerFont(TTFont(name, 'C:/Windows/Fonts/' + font))
W, H = 595.276, 841.89
L, R = 42, W - 42
CW = R - L
INK, MUTED, CYAN, PURPLE, PALE, LINE = [HexColor(x) for x in
    ['#172638', '#56677A', '#008CA9', '#6957C5', '#F0F5FA', '#DCE4EC']]
c = canvas.Canvas(str(OUT), pagesize=(W, H))
c.setTitle('Aurora | Qwen3 MoE: qualidade, RAM e SSD')
c.setAuthor('Projeto Aurora')

def fmt(n, places=0):
    if n is None:
        return 'n/d'
    return f'{n:,.{places}f}'.replace(',', '_').replace('.', ',').replace('_', '.')

def para(text, y, size=10, color=INK, bold=False, x=L, width=CW):
    p = Paragraph(text, ParagraphStyle('p', fontName='AuroraBold' if bold else 'Aurora',
                  fontSize=size, leading=size * 1.4, textColor=color))
    _, h = p.wrap(width, 1200)
    if y - h < 46:
        raise ValueError(f'Conteúdo fora da página: {text[:70]}')
    p.drawOn(c, x, y - h)
    return y - h

def page(number, kicker, title, subtitle):
    c.setFillColor(INK)
    c.rect(0, H - 89, W, 89, fill=1, stroke=0)
    c.drawImage(str(ROOT / 'frontend/public/brand/aurora-wordmark.png'), L, H - 75,
                width=137, height=57, mask='auto')
    para('RELATÓRIO DE EXPERIMENTO', H - 26, 8, HexColor('#A2D8E8'), x=278, width=275)
    para('Qwen3 MoE | RAM + SSD', H - 44, 11, white, x=278, width=275)
    para(kicker.upper(), H - 111, 8.5, CYAN, True)
    y = para(title, H - 132, 23, INK, True)
    y = para(subtitle, y - 10, 10, MUTED)
    c.setFont('Aurora', 8)
    c.setFillColor(MUTED)
    c.drawString(L, 23, 'Aurora | Setembro/2026 | Evidências de protótipo')
    c.drawRightString(R, 23, f'{number} / 4')
    return y - 24

def section(title, y):
    return para(title, y, 13, INK, True) - 10

def table(headers, rows, y, widths):
    cell = ParagraphStyle('cell', fontName='Aurora', fontSize=9, leading=12, textColor=INK)
    head = ParagraphStyle('head', parent=cell, fontName='AuroraBold', textColor=white)
    t = Table([[Paragraph(escape(str(v)), head) for v in headers]] +
              [[Paragraph(escape(str(v)), cell) for v in row] for row in rows], colWidths=widths)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), INK),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [PALE, white]),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 8), ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 8), ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LINEBELOW', (0, -1), (-1, -1), .5, LINE)]))
    _, height = t.wrap(CW, 1200)
    if y - height < 46:
        raise ValueError('Tabela excede a página')
    t.drawOn(c, L, y - height)
    return y - height - 18

def note(title, body, y):
    return para(body, para(title, y, 11, PURPLE, True) - 6, 10) - 19

old, current, moe = [quality[k] for k in ['old', 'current', 'moe']]
delta = 100 * (moe['passed'] - current['passed']) / 24
token_saving = 100 * (1 - moe['tokens'] / current['tokens'])
y = page(1, 'Visão executiva', 'Mais qualidade. Acesso popular ainda em teste.',
         'Comparação de respostas e experimento de execução com pesos no SSD. Dois ambientes separados para não confundir capacidade do modelo com velocidade do computador.')
y = table(['Modelo', 'Contrato original', 'Revisão dos arquivos*'], [
    ['Qwen2.5 Coder 1,5B (antigo)', f"{old['passed']}/24", f"{old['reviewPassed']}/24"],
    ['Qwen3.5 4B (padrão atual)', f"{current['passed']}/24 ({fmt(100*current['passed']/24,1)}%)", f"{current['reviewPassed']}/24"],
    ['Qwen3 Coder 30B MoE', f"{moe['passed']}/24 ({fmt(100*moe['passed']/24,1)}%)", f"{moe['reviewPassed']}/24"],
], y, [205, 141, CW - 346])
y = note('Ganho medido no controle com GPU',
    f"O MoE superou o padrão atual em <b>{fmt(delta,1)} pontos percentuais</b> de aprovação pelo contrato original. Consumiu <b>{fmt(token_saving,1)}% menos tokens</b> no conjunto, incluindo tentativas de correção. São 24 casos por modelo, em tarefas pequenas e delimitadas.", y)
cpu_moe = [p for p in profiles if p['id'].startswith('moe-')]
best = max(cpu_moe, key=lambda p: p['passed'])
y = note('O que o teste de pouca RAM comprovou',
    f"Os quatro limites do processo foram executados. O melhor resultado foi <b>{best['passed']}/24 aprovações</b>. O teto da RAM do processo funciona, mas o cache do Windows usa memória adicional. A máquina de teste possui 32 GB e não representa um computador físico de 16 GB.", y)
y = para('* Revisão posterior, sem nova geração: corrige incompatibilidades do validador com campos numéricos, botão desabilitado ao terminar e linhas ocultas. Os resultados originais foram preservados. A revisão não é uma avaliação independente nem uma taxa de precisão geral.', y, 9, MUTED) - 18
y = note('Decisão recomendada',
    'Manter o modelo compacto como padrão. Oferecer o MoE como opção avançada até reduzir a demora e repetir a avaliação em hardware real de 16 GB, com memória total e energia medidas.', y)
c.showPage()

y = page(2, '01 / CPU, RAM e SSD', 'Quanto custa limitar a RAM?',
         'Mesmas 12 tarefas, duas sementes e limite de 120 segundos por chamada. CPU sem GPU; pesos no NVMe. Cada perfil contém 24 casos completos, incluindo falhas.')
y = table(['Perfil', 'Teto do processo', 'Aprovados', 'Mediana por tarefa', 'Primeiro token¹'], [
    [('Antigo 1,5B' if p['id'] == 'old-30' else f"MoE {p['percent']}%"),
     f"{fmt(p['capBytes']/2**30,1)} GiB", f"{p['passed']}/24",
     f"{fmt(p['medianTaskMs']/1000,1)} s",
     f"{fmt(p['medianInitialFirstTokenMs']/1000,1)} s" if p['medianInitialFirstTokenMs'] is not None else 'n/d']
    for p in profiles], y, [101, 98, 75, 119, CW - 393])
y = para('¹ Mediana da primeira chamada de cada tarefa, quando o primeiro token foi recebido. Não inclui o carregamento inicial do executor. GiB representa 2³⁰ bytes.', y, 9, MUTED) - 20
y = section('Memória observada e cobertura das medições', y)
y = table(['Perfil', 'Pico processo', 'Cache do Windows²', 'Prazo esgotado³'], [
    [p['id'], f"{fmt(p['peakWorkingSet']/2**30,2)} GiB",
     f"{fmt(p['systemCacheMin']/2**30,1)} a {fmt(p['systemCacheMax']/2**30,1)} GiB",
     f"{p['timeoutTasks']}/24"] for p in profiles], y, [101, 113, 166, CW - 380])
y = para('² Cache do sistema inteiro, incluindo memória standby. Não é memória exclusiva do modelo e pode se sobrepor à memória disponível. O teto aplicado ao working set do processo não limita o consumo total do sistema.', y, 9, MUTED) - 15
y = para('³ Tarefas interrompidas ao esgotar o prazo; não prova de resposta incorreta. Pequenos excessos momentâneos do working set foram preservados. Perfis sequenciais; cache não foi limpo. O perfil de 20% foi pausado e retomado. Isso limita conclusões sobre pequenas diferenças de velocidade.', y, 9, MUTED)
c.showPage()

y = page(3, '02 / eficiência das respostas', 'Economia depende de acertar.',
         'Controle em Ollama com GPU disponível e sem teto de RAM. Resultados deste bloco não representam a velocidade do experimento com CPU e SSD.')
y = table(['Modelo', 'Tokens medidos', 'Chamadas', 'Tempo das 24 tarefas'], [
    [name, fmt(q['tokens']), q['calls'], f"{fmt(q['elapsedMs']/1000,1)} s"]
    for name, q in [('Antigo 1,5B', old), ('Atual 4B', current), ('MoE 30B', moe)]
], y, [134, 115, 90, CW - 339])
y = para('Tempo acumulado dos fluxos, incluindo validação e reparos; carregamento e aquecimento separados. Cada modelo usa seu tokenizer e template. Menos tokens não equivale automaticamente a menor energia.', y, 9, MUTED) - 21
y = note('Uma economia concreta a perseguir no harness',
    f"Na auditoria, <b>{moe['redundantRepairCases']} respostas do MoE já corretas</b> receberam reparos desnecessários. Essas chamadas consumiram <b>{fmt(moe['redundantRepairTokens'])} tokens</b>, equivalentes a {fmt(100*moe['redundantRepairTokens']/moe['tokens'],1)}% do total. O desperdício foi observado; a economia em produção ainda depende de corrigir e validar o harness.", y)
y = section('Custo de energia: cenário, não medição', y)
y = para('Tarifa adotada: <b>R$ 1,00/kWh</b>, editável no dashboard. Sem medidor de tomada, o custo real não foi calculado. A fórmula é: tempo em horas × potência média em kW × tarifa.', y) - 15
y = table(['Perfis CPU', 'Duração acumulada', 'Cenário a 100 W*'], [
    [p['id'], f"{fmt(p['elapsedMs']/60000,1)} min",
     f"R$ {fmt(p['elapsedMs']/3600000*.1,4)}"] for p in profiles], y, [134, 176, CW - 310])
y = para('* Potência hipotética, apenas para ilustrar a fórmula. Exclui instalação, carregamento e espera fora das tarefas. Não inclui compra de equipamento ou desgaste do SSD. Custo por aprovação é indefinido quando nenhuma tarefa passa.', y, 9, MUTED)
c.showPage()

y = page(4, '03 / evidências e próximos passos', 'Transformar o protótipo em produto.',
         'A capacidade do MoE melhorou neste conjunto. A execução acessível exige otimização do tempo de resposta, um validador confiável e validação em máquinas do público-alvo.')
y = table(['Prioridade', 'Ação', 'Critério de conclusão'], [
    ['1. Validação', 'Corrigir falsos negativos do harness sem aceitar saídas incorretas.', 'Casos positivos e negativos independentes; redução de reparos indevidos.'],
    ['2. Latência', 'Reduzir o tempo de leitura do pedido e calibrar lote/contexto.', 'Mais tarefas completas dentro do mesmo limite, preservando a qualidade.'],
    ['3. Memória real', 'Repetir em máquinas físicas de 16 GB, SSD SATA e NVMe.', 'Medir RAM total, paginação, primeiro token e resposta completa.'],
    ['4. Produto', 'Selecionar automaticamente modelo e perfil conforme o hardware.', 'Critério público de compatibilidade e retorno seguro ao modelo compacto.'],
], y, [93, 206, CW - 299])
y = section('Escopo e reprodutibilidade', y)
y = para('<b>Amostra:</b> 12 tarefas de jogo, página, aplicativo e BI; duas sementes (211 e 419). 120 casos CPU e 72 casos no controle de qualidade. Testes básicos de retenção são separados. Memórias e skills desativadas para isolar esta comparação.', y, 9.5) - 12
y = para('<b>Máquina:</b> Intel i9-14900K, aproximadamente 31,8 GiB de RAM física, RTX 4090 e NVMe Kingston. GPU desativada no experimento de limites. Modelo MoE com 30 bilhões de parâmetros totais e 3 bilhões ativos; arquivo GGUF de aproximadamente 18,6 GB decimais.', y, 9.5) - 12
y = para('<b>Limites:</b> não houve treinamento ou modificação dos pesos. Templates e defaults de amostragem diferem entre modelos no controle Ollama. O conjunto é pequeno e conhecido durante a auditoria; resultados não comprovam precisão geral, superioridade comercial ou estabilidade em 16 GB.', y, 9.5) - 12
y = para('<b>Diagnóstico adicional:</b> lote 512, em três tarefas selecionadas após as falhas, completou uma tarefa antes interrompida. É uma pista de otimização, não um ganho geral comprovado; a matriz principal manteve o lote 128.', y, 9.5) - 18
y = para('Fontes locais: reports/ssd-moe-v1, ssd-quality-control-v1 e ssd-semantic-review-v1. Manifestos incluem hashes, parâmetros, respostas e telemetria. Relatório gerado dos dados consolidados em ' + escape(d['updatedAt']) + '.', y, 8.5, MUTED) - 10
y = para('Base técnica: <link href="https://github.com/ek15072809/Swap-MoE" color="#008CA9">Swap-MoE</link>, <link href="https://github.com/ggml-org/llama.cpp" color="#008CA9">llama.cpp</link> e <link href="https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-setprocessworkingsetsizeex" color="#008CA9">limite de working set do Windows</link>. Versões exatas fixadas no manifesto.', y, 8.5, MUTED)
c.showPage()
c.save()
print(OUT)
