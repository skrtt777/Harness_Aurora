# Acervo fictício de uma empresa inteira para testar o conhecimento por setor da Aurora.
#   F:/Anaconda/python.exe scripts/gerar_empresa_ia.py [--out F:/EmpresaIA]
# Gera PDFs e planilhas do Excel em uma pasta por setor (Alvorada Alimentos Ltda, empresa
# inventada, dados simulados, referência: 04/10/2026) e, FORA dessa pasta, as perguntas com as
# respostas esperadas em app/empresaIaQuestions.json (calculadas dos mesmos dados).
# Os valores das planilhas são gravados como números, sem fórmulas: o leitor da Aurora lê o
# valor salvo na célula, e o openpyxl não calcula fórmulas.
import argparse
import datetime as dt
import json
import random
import re
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

ap = argparse.ArgumentParser()
ap.add_argument("--out", default="F:/EmpresaIA")
ap.add_argument("--questions", default=str(Path(__file__).resolve().parent.parent / "app" / "empresaIaQuestions.json"))
args = ap.parse_args()
OUT = Path(args.out)
rnd = random.Random(20261004)
HOJE = dt.date(2026, 10, 4)
EMPRESA = "Alvorada Alimentos Ltda"
RODAPE = "Alvorada Alimentos Ltda - empresa fictícia, dados simulados para teste da Aurora"
MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
MESES_NOME = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]


# ---------------------------------------------------------------- formatação
def brl(v, cents=True):
    s = f"{v:,.2f}" if cents else f"{v:,.0f}"
    return "R$ " + s.replace(",", "X").replace(".", ",").replace("X", ".")


def num(v):
    return f"{v:,.0f}".replace(",", ".")


def data(d):
    return d.strftime("%d/%m/%Y")


def money_re(v):
    """Aceita 1.234.567 / 1234567 / 1,23 milhão / 1,2 mi / 1.234 mil."""
    inteiro = int(round(v))
    alts = [num(inteiro).replace(".", r"\.?")]
    if inteiro >= 1_000_000:
        m = inteiro / 1_000_000
        frac = (m - int(m)) * 10  # 23,35 mi pode aparecer como "23,35" ou "23,4"
        alts.append(f"{int(m)}[,.][{int(frac)}{int(round(frac)) % 10}]\\d*\\s*(mi|milh)")
        alts.append(num(round(inteiro / 1000)).replace(".", r"\.?") + r"\s*mil")
    elif inteiro >= 10_000:
        alts.append(f"{inteiro // 1000}[,.]?\\d*\\s*mil")
    return "(" + "|".join(alts) + ")"


# ---------------------------------------------------------------- PDF mínimo
class Pdf:
    """PDF de texto com Helvetica (WinAnsi), títulos, parágrafos, listas e tabelas."""

    W, H, M = 595, 842, 50

    def __init__(self, titulo, subtitulo=""):
        self.pages, self.ops, self.y = [], [], 0
        self.titulo = titulo
        self._new_page()
        self.text(titulo, 17, bold=True)
        if subtitulo:
            self.text(subtitulo, 10, gap=4)
        self.y -= 8
        self.ops.append(f"0.6 G {self.M} {self.y} m {self.W - self.M} {self.y} l S")
        self.y -= 16

    def _new_page(self):
        if self.ops:
            self._footer()
            self.pages.append(self.ops)
        self.ops, self.y = [], self.H - self.M

    def _footer(self):
        n = len(self.pages) + 1
        self.ops.append(self._t(self.M, 30, 7, f"{RODAPE}  |  {self.titulo}  |  página {n}"))

    @staticmethod
    def _esc(s):
        b = s.encode("cp1252", "replace").decode("latin-1")
        return b.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    def _t(self, x, y, size, s, bold=False):
        return f"BT /{'F2' if bold else 'F1'} {size} Tf {x} {y} Td ({self._esc(s)}) Tj ET"

    def _need(self, h):
        if self.y - h < 60:
            self._new_page()

    def _wrap(self, s, size, width):
        maxc = int(width / (size * 0.5))
        lines, cur = [], ""
        for w in s.split():
            if len(cur) + len(w) + 1 > maxc and cur:
                lines.append(cur)
                cur = w
            else:
                cur = f"{cur} {w}".strip()
        return lines + ([cur] if cur else [])

    def text(self, s, size=10, bold=False, gap=6, indent=0):
        for line in self._wrap(s, size, self.W - 2 * self.M - indent):
            self._need(size + 4)
            self.ops.append(self._t(self.M + indent, self.y, size, line, bold))
            self.y -= size + 4
        self.y -= gap

    def h(self, s):
        self.y -= 4
        self._need(40)
        self.text(s, 12.5, bold=True, gap=4)

    def p(self, s):
        self.text(s, 10)

    def bullets(self, items):
        for it in items:
            self._need(14)
            self.ops.append(self._t(self.M + 6, self.y, 10, "•"))
            self.text(it, 10, gap=2, indent=18)
        self.y -= 4

    def table(self, header, rows, widths=None):
        n = len(header)
        total = self.W - 2 * self.M
        widths = widths or [total / n] * n
        widths = [w * total / sum(widths) for w in widths]

        def row(cells, bold):
            self._need(16)
            x = self.M
            for c, w in zip(cells, widths):
                s = str(c)
                maxc = int(w / (8.5 * 0.5)) - 1
                if len(s) > maxc:
                    s = s[: max(1, maxc - 1)] + "."
                self.ops.append(self._t(x + 3, self.y, 8.5, s, bold))
                x += w
            self.ops.append(f"0.8 G {self.M} {self.y - 4} m {self.M + total} {self.y - 4} l S")
            self.y -= 14

        row(header, True)
        for r in rows:
            row(r, False)
        self.y -= 8

    def save(self, path):
        self._footer()
        self.pages.append(self.ops)
        objs = ["<< /Type /Catalog /Pages 2 0 R >>", None,
                "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
                "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"]
        kids = []
        for ops in self.pages:
            stream = "\n".join(ops).encode("latin-1")
            objs.append(f"<< /Length {len(stream)} >>\nstream\n".encode("latin-1") + stream + b"\nendstream")
            objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {self.W} {self.H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {len(objs)} 0 R >>")
            kids.append(len(objs))
        objs[1] = f"<< /Type /Pages /Kids [{' '.join(f'{k} 0 R' for k in kids)}] /Count {len(kids)} >>"
        info = f"<< /Title ({self._esc(self.titulo)}) /Producer (gerar_empresa_ia.py) >>"
        objs.append(info)
        out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offs = []
        for i, o in enumerate(objs, 1):
            offs.append(len(out))
            body = o if isinstance(o, bytes) else o.encode("latin-1")
            out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
        x = len(out)
        out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
        out += "".join(f"{o:010d} 00000 n \n" for o in offs).encode()
        out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R /Info {len(objs)} 0 R >>\nstartxref\n{x}\n%%EOF\n".encode()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(bytes(out))


# ---------------------------------------------------------------- Excel
HEAD_FILL = PatternFill("solid", fgColor="1F4E78")


def xlsx(path, sheets):
    """sheets: [(nome, cabeçalho, linhas, {coluna: formato})]."""
    wb = Workbook()
    wb.remove(wb.active)
    for name, header, rows, fmts in sheets:
        ws = wb.create_sheet(name[:31])
        ws.append(header)
        for c in ws[1]:
            c.font = Font(bold=True, color="FFFFFF")
            c.fill = HEAD_FILL
            c.alignment = Alignment(vertical="center")
        for r in rows:
            ws.append(list(r))
        for col, f in (fmts or {}).items():
            for cell in ws[col][1:]:
                cell.number_format = f
        for i, h in enumerate(header, 1):
            width = max([len(str(h))] + [len(str(r[i - 1])) for r in rows if i - 1 < len(r)])
            ws.column_dimensions[get_column_letter(i)].width = min(48, max(10, width + 2))
        ws.freeze_panes = "A2"
    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(path)


MOEDA = '"R$" #,##0.00'
DATA = "DD/MM/YYYY"
PCT = "0.0%"

QUESTIONS = []


def q(setor, prompt, expect, note="", not_found=False, avoid=None):
    QUESTIONS.append({"id": f"{slug(setor)}-{len([x for x in QUESTIONS if x['setor'] == setor]) + 1}",
                      "setor": setor, "prompt": prompt, "expect": expect, "avoid": avoid or [],
                      "notFound": not_found, "note": note})


def slug(s):
    s = s.lower()
    for a, b in zip("áàâãéêíóôõúç", "aaaaeeiooouc"):
        s = s.replace(a, b)
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


# ================================================================ pessoas
NOMES = ["Ana", "Bruno", "Carla", "Diego", "Eduarda", "Felipe", "Gabriela", "Henrique", "Isabela", "João",
         "Karina", "Lucas", "Mariana", "Nicolas", "Olívia", "Paulo", "Queila", "Rafael", "Sabrina", "Tiago",
         "Úrsula", "Vinícius", "Wesley", "Yasmin", "Alice", "Bernardo", "Cecília", "Davi", "Elisa", "Fábio",
         "Gustavo", "Helena", "Igor", "Júlia", "Leonardo", "Larissa", "Marcos", "Natália", "Otávio", "Patrícia"]
SOBRENOMES = ["Almeida", "Barbosa", "Cardoso", "Dias", "Esteves", "Ferreira", "Gomes", "Henriques", "Lima", "Moura",
              "Nogueira", "Oliveira", "Pereira", "Queiroz", "Ribeiro", "Santos", "Teixeira", "Vieira", "Xavier", "Rocha",
              "Souza", "Costa", "Martins", "Araújo", "Batista", "Campos", "Freitas", "Lopes", "Macedo", "Pinto"]
SETORES_PESSOAL = {  # setor: (headcount, cargos)
    "Produção": (38, ["Operador de Produção", "Auxiliar de Produção", "Líder de Linha", "Mecânico de Manutenção"]),
    "Logística": (16, ["Motorista", "Conferente", "Auxiliar de Expedição", "Operador de Empilhadeira"]),
    "Comercial": (12, ["Vendedor Externo", "Assistente Comercial", "Representante Comercial"]),
    "Qualidade": (7, ["Analista de Qualidade", "Técnico de Laboratório"]),
    "Administrativo": (6, ["Assistente Administrativo", "Recepcionista"]),
    "Financeiro": (5, ["Analista Financeiro", "Assistente Financeiro"]),
    "Controladoria": (3, ["Analista de Controladoria", "Analista de Custos"]),
    "Compras": (4, ["Comprador", "Assistente de Compras"]),
    "TI": (4, ["Analista de Suporte", "Analista de Sistemas"]),
    "RH": (5, ["Analista de RH", "Assistente de Departamento Pessoal"]),
    "Marketing": (3, ["Analista de Marketing", "Designer"]),
    "SSMA": (3, ["Técnico de Segurança do Trabalho", "Analista Ambiental"]),
    "Jurídico": (2, ["Advogado", "Assistente Jurídico"]),
    "Fiscal": (3, ["Analista Fiscal", "Assistente Contábil"]),
}
GESTORES = {
    "Diretoria": ("Roberto Andrade Lins", "Diretor-Geral", "2101"),
    "RH": ("Simone Carvalho Prado", "Gerente de RH", "2201"),
    "Controladoria": ("Marcelo Tavares Brito", "Controller", "2301"),
    "Financeiro": ("Renata Couto Siqueira", "Gerente Financeira", "2311"),
    "Comercial": ("André Pacheco Leal", "Gerente Comercial", "2401"),
    "Marketing": ("Luana Morais Fontes", "Coordenadora de Marketing", "2451"),
    "Compras": ("Fernando Rezende Cunha", "Coordenador de Compras", "2501"),
    "Logística": ("Cláudio Bastos Neri", "Gerente de Logística", "2601"),
    "Produção": ("Sérgio Valadares Paiva", "Gerente Industrial", "2701"),
    "Qualidade": ("Priscila Antunes Melo", "Coordenadora da Qualidade", "2751"),
    "SSMA": ("Rodrigo Falcão Dantas", "Coordenador de SSMA", "2761"),
    "TI": ("Thiago Mendonça Reis", "Coordenador de TI", "2801"),
    "Jurídico": ("Débora Sampaio Guedes", "Advogada Coordenadora", "2901"),
    "Fiscal": ("Hélio Barreto Viana", "Contador", "2321"),
}

pessoas, usados = [], set()
mat = 1001
for setor, (n, cargos) in SETORES_PESSOAL.items():
    for i in range(n):
        while True:
            nome = f"{rnd.choice(NOMES)} {rnd.choice(SOBRENOMES)} {rnd.choice(SOBRENOMES)}"
            if nome not in usados and len(set(nome.split()[1:])) == 2:
                break
        usados.add(nome)
        adm = dt.date(rnd.randint(2012, 2025), rnd.randint(1, 12), rnd.randint(1, 28))
        cargo = cargos[0] if i < n * 0.6 else rnd.choice(cargos)
        base = {"Operador": 2600, "Auxiliar": 2100, "Líder": 4200, "Mecânico": 4500, "Motorista": 3300,
                "Conferente": 2500, "Vendedor": 3800, "Assistente": 2700, "Representante": 4000, "Analista": 5200,
                "Técnico": 4100, "Recepcionista": 2200, "Comprador": 5000, "Advogado": 9500, "Designer": 4300,
                "Operador de Empilhadeira": 2900}
        sal = next((v for k, v in base.items() if cargo.startswith(k)), 3000) * rnd.uniform(0.95, 1.25)
        pessoas.append({"mat": mat, "nome": nome, "setor": setor, "cargo": cargo, "adm": adm, "sal": round(sal, 2)})
        mat += 1
# Duas admissões no mês corrente e três desligados em 2026 (fora do quadro ativo).
for nome, setor, cargo, d in [("Vitória Campos Lins", "Comercial", "Vendedor Externo", dt.date(2026, 10, 1)),
                              ("Caio Martins Rocha", "Produção", "Operador de Produção", dt.date(2026, 10, 1))]:
    pessoas.append({"mat": mat, "nome": nome, "setor": setor, "cargo": cargo, "adm": d, "sal": 3800.0 if setor == "Comercial" else 2600.0})
    mat += 1
ativos = len(pessoas)

# Férias 2026: exatamente 9 começam em outubro; 4 começaram em setembro e terminam em outubro.
elegiveis = [p for p in pessoas if p["adm"] <= dt.date(2025, 9, 30)]
rnd.shuffle(elegiveis)
ferias = []
inicio_out = sorted(elegiveis[:9], key=lambda p: p["mat"])
for i, p in enumerate(inicio_out):
    ini = dt.date(2026, 10, [5, 5, 13, 13, 13, 19, 19, 26, 26][i])
    dias = [30, 20, 30, 15, 30, 20, 30, 10, 30][i]
    ferias.append((p, ini, dias, "Aprovada"))
for p in elegiveis[9:13]:
    ini = dt.date(2026, 9, rnd.choice([14, 21, 28]))
    ferias.append((p, ini, 30, "Em gozo"))
for p in elegiveis[13:]:
    m = rnd.choice([1, 2, 3, 4, 5, 6, 7, 8, 11, 12])
    ini = dt.date(2026, m, rnd.choice([1, 6, 13, 20]))
    dias = rnd.choice([30, 30, 20, 15])
    ferias.append((p, ini, dias, "Gozada" if m < 10 else "Programada"))
ferias.sort(key=lambda f: (f[1], f[0]["mat"]))

# ================================================================ RH
RH = OUT / "RH"
xlsx(RH / "Férias" / "Controle de Férias 2026.xlsx", [
    ("Férias 2026", ["Matrícula", "Funcionário", "Setor", "Cargo", "Início das férias", "Fim das férias", "Dias", "Status"],
     [(p["mat"], p["nome"], p["setor"], p["cargo"], ini, ini + dt.timedelta(days=d - 1), d, st) for p, ini, d, st in ferias],
     {"E": DATA, "F": DATA}),
    ("Legenda", ["Status", "Significado"], [("Gozada", "Férias já tiradas"), ("Em gozo", "Funcionário de férias agora"),
                                           ("Aprovada", "Aprovada pelo gestor, vai começar"), ("Programada", "Prevista, ainda sem aprovação")], {}),
])
pdf = Pdf("Política de Férias", "RH - versão 3.2 - vigente desde 01/02/2026")
pdf.h("1. Quem tem direito")
pdf.p("Todo funcionário CLT com 12 meses de trabalho (período aquisitivo) tem direito a 30 dias de férias, a serem tirados nos 12 meses seguintes (período concessivo).")
pdf.h("2. Como pedir")
pdf.bullets(["Solicite pelo Portal do Colaborador com no mínimo 45 dias de antecedência.",
             "O gestor aprova em até 5 dias úteis; depois o RH confere o saldo e programa o pagamento.",
             "O aviso de férias é entregue ao funcionário com 30 dias de antecedência, conforme a CLT.",
             "O pagamento (salário do período + 1/3 constitucional) cai até 2 dias antes do início."])
pdf.h("3. Fracionamento e abono")
pdf.bullets(["As férias podem ser divididas em até 3 períodos: um deles com no mínimo 14 dias e os outros com no mínimo 5 dias cada.",
             "É possível vender até 10 dias (abono pecuniário), pedindo junto com a solicitação.",
             "Não é permitido começar as férias nos 2 dias que antecedem feriado ou o descanso semanal."])
pdf.h("4. Férias coletivas")
pdf.p("A fábrica terá férias coletivas de 22/12/2026 a 02/01/2027 para as áreas de Produção e Logística. Esses dias serão descontados do saldo de cada funcionário.")
pdf.h("5. Contato")
pdf.p(f"Dúvidas: Departamento Pessoal, ramal 2204, ou {GESTORES['RH'][0]} (Gerente de RH), ramal {GESTORES['RH'][2]}.")
pdf.save(RH / "Férias" / "Política de Férias.pdf")

quadro = sorted([p for p in pessoas], key=lambda p: (p["setor"], p["nome"]))
por_setor = {}
for p in pessoas:
    por_setor[p["setor"]] = por_setor.get(p["setor"], 0) + 1
xlsx(RH / "Quadro de Funcionários - Out 2026.xlsx", [
    ("Quadro ativo", ["Matrícula", "Nome", "Setor", "Cargo", "Admissão", "Salário base"],
     [(p["mat"], p["nome"], p["setor"], p["cargo"], p["adm"], p["sal"]) for p in quadro], {"E": DATA, "F": MOEDA}),
    ("Resumo por setor", ["Setor", "Funcionários"], sorted(por_setor.items(), key=lambda x: -x[1]) + [("TOTAL", ativos)], {}),
])
deslig = [("Marcelo Pinto Souza", "Logística", "Motorista", dt.date(2026, 3, 18), "Pedido de demissão"),
          ("Juliana Rocha Dias", "Comercial", "Vendedor Externo", dt.date(2026, 6, 2), "Dispensa sem justa causa"),
          ("Otávio Lima Freitas", "Produção", "Auxiliar de Produção", dt.date(2026, 8, 25), "Término de contrato de experiência")]
adm2026 = [p for p in pessoas if p["adm"].year == 2026]
xlsx(RH / "Admissões e Desligamentos 2026.xlsx", [
    ("Admissões", ["Nome", "Setor", "Cargo", "Data de admissão"], [(p["nome"], p["setor"], p["cargo"], p["adm"]) for p in adm2026], {"D": DATA}),
    ("Desligamentos", ["Nome", "Setor", "Cargo", "Data de desligamento", "Motivo"], deslig, {"D": DATA}),
])
pdf = Pdf("Tabela de Benefícios 2026", "RH - benefícios válidos de janeiro a dezembro de 2026")
pdf.table(["Benefício", "Valor / regra", "Quem tem direito"], [
    ("Vale-refeição", "R$ 45,00 por dia útil", "Todos, exceto quem almoça no refeitório"),
    ("Refeitório", "Almoço no local, sem custo", "Produção, Logística e Qualidade"),
    ("Vale-alimentação", "R$ 380,00 por mês", "Todos"),
    ("Plano de saúde", "Coparticipação de 20% nas consultas", "Titular e dependentes"),
    ("Plano odontológico", "R$ 18,90 por vida, descontado em folha", "Opcional"),
    ("Vale-transporte", "Desconto de até 6% do salário", "Quem solicitar"),
    ("Seguro de vida", "24 salários, custeado pela empresa", "Todos"),
    ("Auxílio-creche", "R$ 520,00 por mês até 5 anos e 11 meses", "Mães e pais com guarda"),
], [1.2, 2, 1.8])
pdf.p("Inclusão de dependentes no plano de saúde: até 30 dias após o nascimento ou casamento, com certidão, pelo Portal do Colaborador.")
pdf.save(RH / "Benefícios" / "Tabela de Benefícios 2026.pdf")
treinos = [("Integração de novos funcionários", dt.date(2026, 10, 6), "RH", "Todos os admitidos em outubro", 4),
           ("NR-11 Empilhadeira (reciclagem)", dt.date(2026, 10, 15), "SSMA", "Operadores de empilhadeira", 8),
           ("Excel intermediário", dt.date(2026, 10, 20), "RH", "Administrativo e Financeiro", 12),
           ("Boas Práticas de Fabricação", dt.date(2026, 11, 9), "Qualidade", "Produção", 4),
           ("Liderança para líderes de linha", dt.date(2026, 11, 17), "RH", "Líderes de linha", 16),
           ("Brigada de incêndio", dt.date(2026, 12, 3), "SSMA", "Brigadistas", 8)]
xlsx(RH / "Treinamentos" / "Calendário de Treinamentos 2º Semestre 2026.xlsx", [
    ("Calendário", ["Treinamento", "Data", "Área responsável", "Público", "Carga horária (h)"], treinos, {"B": DATA})])

out_names = [p["nome"] for p, ini, d, st in ferias if ini.month == 10]
q("RH", "Mostre pra mim quantos funcionários vão entrar de férias esse mês?",
  [r"\b9\b|\bnove\b"] + [re.escape(n.split()[0]) for n in out_names[:3]],
  "referência outubro/2026: 9 começam em outubro; 4 já estão em gozo desde setembro e não contam")
q("RH", "Quem está de férias agora?", [re.escape(p["nome"].split()[0]) for p, ini, d, st in ferias if st == "Em gozo"][:2] + [r"\b4\b|quatro"],
  "status 'Em gozo' em 04/10/2026")
q("RH", "Quantos funcionários a empresa tem hoje e qual setor tem mais gente?", [rf"\b{ativos}\b", "Produ[çc][ãa]o"])
q("RH", "Quanto é o vale-refeição por dia?", [r"45,00|R\$\s*45"])
q("RH", "Posso vender parte das minhas férias? Quantos dias?", [r"\b10\b|dez dias"])
q("RH", "Quando são as férias coletivas da fábrica?", [r"22/12", r"02/01|2/1/2027|2 de janeiro"])
q("RH", "Quem foi desligado esse ano?", ["Marcelo", "Juliana", "Ot[áa]vio"])
q("RH", "Qual é a política de home office da empresa?", [], "não existe nenhum documento sobre home office", not_found=True,
  avoid=[r"home office[^.\n]{0,60}(\d+ dias|permitid)"])

# ================================================================ Controladoria
CENTROS = [("CC-100", "Administrativo", 1_850_000), ("CC-200", "Comercial", 3_100_000), ("CC-250", "Marketing", 960_000),
           ("CC-300", "Produção", 9_400_000), ("CC-350", "Qualidade", 780_000), ("CC-400", "Logística", 3_650_000),
           ("CC-500", "TI", 1_150_000), ("CC-600", "RH", 640_000), ("CC-650", "SSMA", 420_000),
           ("CC-700", "Financeiro e Controladoria", 1_020_000), ("CC-750", "Jurídico", 380_000)]
SAZ = [0.075, 0.075, 0.082, 0.08, 0.085, 0.083, 0.082, 0.085, 0.083, 0.087, 0.088, 0.095]
orc_rows, real_rows, resumo = [], [], []
desvio = {"Produção": 1.071, "Logística": 1.096, "Marketing": 0.82, "TI": 1.13, "Comercial": 0.97}
tot_orc = tot_orc9 = tot_real9 = 0
for cc, nome, anual in CENTROS:
    mens = [round(anual * s / sum(SAZ), 2) for s in SAZ]
    real = [round(v * desvio.get(nome, 1.0) * rnd.uniform(0.96, 1.04), 2) for v in mens[:9]]
    orc_rows.append((cc, nome, *mens, round(sum(mens), 2)))
    real_rows.append((cc, nome, *real, *([None] * 3), round(sum(real), 2)))
    o9, r9 = sum(mens[:9]), sum(real)
    resumo.append((cc, nome, round(sum(mens), 2), round(o9, 2), round(r9, 2), round(r9 - o9, 2), round(r9 / o9 - 1, 4), round(r9 / sum(mens), 4)))
    tot_orc += sum(mens)
    tot_orc9 += o9
    tot_real9 += r9
resumo.append(("", "TOTAL", round(tot_orc, 2), round(tot_orc9, 2), round(tot_real9, 2), round(tot_real9 - tot_orc9, 2),
               round(tot_real9 / tot_orc9 - 1, 4), round(tot_real9 / tot_orc, 4)))
xlsx(OUT / "Controladoria" / "Orçamento 2026 - Orçado x Realizado.xlsx", [
    ("Resumo até Setembro", ["Centro de custo", "Área", "Orçado anual 2026", "Orçado Jan-Set", "Realizado Jan-Set", "Desvio (R$)", "Desvio (%)", "% do anual executado"],
     resumo, {"C": MOEDA, "D": MOEDA, "E": MOEDA, "F": MOEDA, "G": PCT, "H": PCT}),
    ("Orçado mensal", ["Centro de custo", "Área", *MESES, "Total 2026"], orc_rows, {get_column_letter(i): MOEDA for i in range(3, 16)}),
    ("Realizado mensal", ["Centro de custo", "Área", *MESES, "Total realizado"], real_rows, {get_column_letter(i): MOEDA for i in range(3, 16)}),
])
xlsx(OUT / "Controladoria" / "Histórico" / "Orçamento 2025 - Fechado.xlsx", [
    ("Fechamento 2025", ["Centro de custo", "Área", "Orçado 2025", "Realizado 2025"],
     [(cc, nome, round(a * 0.91, 2), round(a * 0.91 * rnd.uniform(0.97, 1.05), 2)) for cc, nome, a in CENTROS], {"C": MOEDA, "D": MOEDA})])
receita9, cmv9 = 48_620_000.0, 31_150_000.0
desp9 = tot_real9 - resumo[3][4]  # despesas operacionais = tudo menos Produção (custo já no CMV)
ebitda9 = receita9 - cmv9 - desp9
pdf = Pdf("Relatório Gerencial - Setembro 2026", "Controladoria - acumulado de janeiro a setembro de 2026")
pdf.h("1. Resultado acumulado")
pdf.table(["Indicador", "Jan-Set 2026", "Observação"], [
    ("Receita líquida", brl(receita9), "+8,4% sobre o mesmo período de 2025"),
    ("Custo dos produtos vendidos", brl(cmv9), "inclui Produção (CC-300)"),
    ("Despesas operacionais", brl(desp9), "demais centros de custo"),
    ("EBITDA", brl(ebitda9), f"margem de {ebitda9 / receita9 * 100:.1f}%".replace(".", ",")),
], [1.6, 1.3, 2])
pdf.h("2. Orçamento")
pdf.p(f"O orçamento total de 2026 é de {brl(tot_orc)}. Até setembro foram realizados {brl(tot_real9)}, contra {brl(tot_orc9)} orçados no período: "
      f"desvio de {(tot_real9 / tot_orc9 - 1) * 100:+.1f}% ".replace(".", ",") + f"({(tot_real9 / tot_orc) * 100:.1f}% do ano executado).".replace(".", ","))
pdf.p("Pontos de atenção: TI está 13% acima do orçado no período por causa da troca antecipada dos servidores; Logística está cerca de 10% acima por diesel e manutenção da frota; "
      "Produção está 7% acima por energia elétrica. Marketing está 18% abaixo porque a campanha de Natal foi adiada para novembro.")
pdf.h("3. Próximos passos")
pdf.bullets(["Revisão do forecast de outubro a dezembro até 20/10/2026.",
             "Congelamento de novas despesas não essenciais de TI e Logística até o fechamento do ano.",
             "Apresentação do orçamento 2027 para a Diretoria em 24/11/2026."])
pdf.save(OUT / "Controladoria" / "Relatório Gerencial - Setembro 2026.pdf")
xlsx(OUT / "Controladoria" / "Centros de Custo.xlsx", [
    ("Centros de custo", ["Código", "Área", "Responsável"], [(cc, nome, GESTORES.get(nome.split(" e ")[0], GESTORES["Controladoria"])[0]) for cc, nome, _ in CENTROS], {})])

q("Controladoria", "Como está o budget esse ano?", [money_re(tot_orc), money_re(tot_real9)],
  "orçado 2026 total, realizado Jan-Set e desvio")
q("Controladoria", "Qual área está mais acima do orçamento?", [r"\bTI\b|Tecnologia"])
q("Controladoria", "Quanto foi o EBITDA acumulado até setembro?", [money_re(ebitda9)])
q("Controladoria", "Qual foi o orçamento de Logística em 2025?", [money_re(CENTROS[5][2] * 0.91)], "distrator: não confundir com 2026")
q("Controladoria", "Quando o orçamento de 2027 vai ser apresentado?", [r"24/11|24 de novembro"])

# ================================================================ Financeiro
FORN = ["Agro Sertão Grãos", "Embalagens Recôncavo", "Transportadora Rota Leste", "Energia Paraguaçu", "Óleos Vale do Jacuípe",
        "Mecânica Industrial Santa Rita", "Gráfica Ponto Certo", "Distribuidora de Gás Litoral", "Laboratório Analítica Norte", "Tech Serviços de Rede"]
cp = []
for i in range(26):
    f = rnd.choice(FORN)
    venc = dt.date(2026, 10, rnd.randint(1, 31))
    v = round(rnd.uniform(3_000, 180_000), 2)
    cp.append((f"NF {rnd.randint(10000, 99999)}", f, venc, v, "Pago" if venc < HOJE else "A pagar"))
cp.sort(key=lambda r: r[2])
apagar = sum(r[3] for r in cp if r[4] == "A pagar")
maior_cp = max(cp, key=lambda r: r[3])
xlsx(OUT / "Financeiro" / "Contas a Pagar - Outubro 2026.xlsx", [
    ("Outubro 2026", ["Documento", "Fornecedor", "Vencimento", "Valor", "Situação"], cp, {"C": DATA, "D": MOEDA})])
CLIENTES = ["Supermercado Bom Preço Feira", "Rede Mais Atacarejo", "Mercadinho São Jorge", "Padaria Pão Dourado", "Atacadão Sertanejo",
            "Restaurante Sabor da Terra", "Hotel Litoral Norte", "Cesta Básica Bahia", "Empório Central", "Distribuidora Recôncavo"]
cr = []
for c in CLIENTES:
    for _ in range(rnd.randint(1, 3)):
        venc = dt.date(2026, rnd.randint(6, 10), rnd.randint(1, 28))
        v = round(rnd.uniform(8_000, 95_000), 2)
        atraso = max(0, (HOJE - venc).days)
        cr.append((c, f"Duplicata {rnd.randint(1000, 9999)}", venc, v, atraso, "Em atraso" if atraso > 0 else "A vencer"))
inad = sorted([r for r in cr if r[4] > 30], key=lambda r: -r[3])
inad_total = sum(r[3] for r in inad)
por_cliente = {}
for r in inad:
    por_cliente[r[0]] = por_cliente.get(r[0], 0) + r[3]
pior_cliente = max(por_cliente, key=por_cliente.get)
xlsx(OUT / "Financeiro" / "Contas a Receber e Inadimplência - Set 2026.xlsx", [
    ("Contas a receber", ["Cliente", "Título", "Vencimento", "Valor", "Dias em atraso (em 04/10/2026)", "Situação"], cr, {"C": DATA, "D": MOEDA}),
    ("Inadimplência >30 dias", ["Cliente", "Valor em atraso"], sorted(por_cliente.items(), key=lambda x: -x[1]) + [("TOTAL", round(inad_total, 2))], {"B": MOEDA}),
])
saldo = 2_340_000.0
fluxo = []
for m in range(12):
    ent = round(5_400_000 * SAZ[m] / 0.083 * rnd.uniform(0.95, 1.05), 2)
    sai = round(ent * rnd.uniform(0.9, 1.04), 2)
    ini = saldo
    saldo = round(saldo + ent - sai, 2)
    fluxo.append((MESES_NOME[m].capitalize(), ini, ent, sai, saldo, "Realizado" if m < 9 else "Projetado"))
saldo_set = fluxo[8][4]
xlsx(OUT / "Financeiro" / "Fluxo de Caixa 2026.xlsx", [
    ("Fluxo mensal", ["Mês", "Saldo inicial", "Entradas", "Saídas", "Saldo final", "Tipo"], fluxo, {"B": MOEDA, "C": MOEDA, "D": MOEDA, "E": MOEDA})])
pdf = Pdf("Política de Viagens e Reembolso de Despesas", "Financeiro - versão 2.0 - vigente desde 01/03/2026")
pdf.h("1. Aprovação")
pdf.p("Toda viagem a trabalho precisa ser aprovada pelo gestor imediato no sistema de despesas com pelo menos 7 dias de antecedência (exceto urgências aprovadas pelo diretor).")
pdf.h("2. Limites")
pdf.table(["Item", "Limite"], [("Hospedagem - capitais", "R$ 320,00 por diária"), ("Hospedagem - interior", "R$ 220,00 por diária"),
                               ("Alimentação", "R$ 110,00 por dia de viagem"), ("Quilometragem (carro próprio)", "R$ 1,35 por km"),
                               ("Passagem aérea", "classe econômica, comprada pelo Financeiro")], [2, 2])
pdf.h("3. Prestação de contas")
pdf.bullets(["Enviar notas fiscais no sistema em até 5 dias úteis após o retorno.", "O reembolso é pago na quinzena seguinte à aprovação.",
             "Bebida alcoólica, multas de trânsito e despesas pessoais não são reembolsadas."])
pdf.save(OUT / "Financeiro" / "Política de Viagens e Reembolso de Despesas.pdf")

q("Financeiro", "Quanto ainda temos a pagar de fornecedores em outubro?", [money_re(apagar)])
q("Financeiro", "Qual cliente deve mais pra gente com atraso acima de 30 dias?", [re.escape(pior_cliente.split()[0])])
q("Financeiro", "Qual o limite de diária de hotel numa capital?", [r"320"])
q("Financeiro", "Qual foi o saldo de caixa no fim de setembro?", [money_re(saldo_set)])

# ================================================================ Comercial
VEND = [("Vitor Santana", "Feira de Santana"), ("Aline Moreira", "Salvador e RMS"), ("Ricardo Prates", "Salvador e RMS"),
        ("Tânia Rios", "Recôncavo"), ("Jorge Brandão", "Sul da Bahia"), ("Lívia Cordeiro", "Sertão"),
        ("Edson Matos", "Chapada Diamantina"), ("Camila Nunes", "Feira de Santana")]
vendas, metas = [], []
ytd = {}
for i, (v, reg) in enumerate(VEND):
    base = rnd.uniform(380_000, 720_000)
    mes = [round(base * SAZ[m] / 0.083 * rnd.uniform(0.85, 1.15), 2) for m in range(9)]
    if i == 1:
        mes = [round(x * 1.22, 2) for x in mes]
    vendas.append((v, reg, *mes, round(sum(mes), 2)))
    ytd[v] = sum(mes)
    meta = round(base * 12 * 1.08, -3)
    metas.append((v, reg, meta, round(sum(mes), 2), round(sum(mes) / meta, 4)))
top = max(ytd, key=ytd.get)
total_vendas = sum(ytd.values())
regioes = {}
for v, reg in VEND:
    regioes[reg] = regioes.get(reg, 0) + ytd[v]
xlsx(OUT / "Comercial" / "Vendas 2026 por Vendedor.xlsx", [
    ("Vendas Jan-Set", ["Vendedor", "Região", *MESES[:9], "Total Jan-Set"], vendas, {get_column_letter(i): MOEDA for i in range(3, 13)}),
    ("Por região", ["Região", "Vendas Jan-Set"], sorted(regioes.items(), key=lambda x: -x[1]) + [("TOTAL", round(total_vendas, 2))], {"B": MOEDA}),
])
xlsx(OUT / "Comercial" / "Metas Comerciais 2026.xlsx", [
    ("Metas", ["Vendedor", "Região", "Meta anual 2026", "Realizado Jan-Set", "% da meta atingido"], metas, {"C": MOEDA, "D": MOEDA, "E": PCT})])
PRODUTOS = [("FAR-001", "Farinha de mandioca 1 kg", 7.90), ("FAR-002", "Farinha de mandioca 5 kg", 36.50), ("TAP-001", "Goma de tapioca 500 g", 6.40),
            ("BIS-010", "Biscoito de polvilho 100 g", 4.20), ("BIS-011", "Biscoito de goma 200 g", 6.90), ("FUB-001", "Flocão de milho 500 g", 3.80),
            ("CUS-001", "Cuscuz pronto 400 g", 5.60), ("CAF-001", "Café torrado e moído 250 g", 15.90), ("CAF-002", "Café torrado e moído 500 g", 29.90)]
pdf = Pdf("Tabela de Preços - vigência a partir de 01/10/2026", "Comercial - preços para revenda, sem impostos, FOB Feira de Santana")
pdf.table(["Código", "Produto", "Preço unitário", "Caixa com"], [(c, n, brl(p), "12 un" if "5 kg" not in n else "4 un") for c, n, p in PRODUTOS], [0.8, 2.6, 1.1, 0.8])
pdf.h("Condições comerciais")
pdf.bullets(["Pedido mínimo: R$ 1.500,00 por entrega.", "Desconto de 3% para pagamento antecipado (até o dia da entrega).",
             "Prazo padrão: 28 dias; clientes novos começam com pagamento à vista nos 3 primeiros pedidos.",
             "Reajuste médio desta tabela: 4,5% sobre a tabela de abril de 2026, por causa do preço da mandioca."])
pdf.save(OUT / "Comercial" / "Tabela de Preços - Out 2026.pdf")
abc = sorted([(c, round(rnd.uniform(400_000, 4_200_000), 2)) for c in CLIENTES], key=lambda x: -x[1])
xlsx(OUT / "Comercial" / "Principais Clientes - Curva ABC 2026.xlsx", [
    ("Curva ABC", ["Cliente", "Faturamento Jan-Set", "Classe"], [(c, v, "A" if i < 3 else "B" if i < 7 else "C") for i, (c, v) in enumerate(abc)], {"B": MOEDA})])

q("Comercial", "Quem é o vendedor que mais vendeu no ano?", [re.escape(top.split()[0])])
q("Comercial", "Qual o preço da farinha de mandioca de 1 kg?", [r"7,90"])
q("Comercial", "Qual é o pedido mínimo para entrega?", [r"1\.?500"])
q("Comercial", "Quem é nosso maior cliente?", [re.escape(abc[0][0].split()[0])])

# ================================================================ Marketing
CAMP = [("Verão Tapioca", "Jan-Fev", 120_000, 48_000, 1_310), ("São João Alvorada", "Mai-Jun", 260_000, 255_000, 4_820),
        ("Volta às aulas - biscoitos", "Fev-Mar", 90_000, 86_500, 1_120), ("Café da manhã baiano", "Ago-Set", 150_000, 141_000, 2_050),
        ("Natal em Família", "Nov-Dez (adiada)", 220_000, 0, 0), ("Feira Bahia Food 2026", "Out", 80_000, 0, 0)]
xlsx(OUT / "Marketing" / "Campanhas 2026.xlsx", [
    ("Campanhas", ["Campanha", "Período", "Verba prevista", "Gasto até set", "Leads gerados"], CAMP, {"C": MOEDA, "D": MOEDA})])
pdf = Pdf("Plano de Marketing 2026", "Marketing - aprovado pela Diretoria em 12/12/2025")
pdf.h("Objetivos")
pdf.bullets(["Aumentar em 15% o reconhecimento da marca Alvorada no interior da Bahia.", "Lançar a linha de café em 3 novas regiões.",
             "Chegar a 40 mil seguidores no Instagram até dezembro de 2026."])
pdf.h("Verba")
pdf.p(f"A verba anual de Marketing (centro de custo CC-250) é de {brl(CENTROS[2][2])}, dos quais {brl(sum(c[2] for c in CAMP))} vão para as campanhas listadas abaixo e o restante para equipe, agência e materiais de ponto de venda.")
pdf.table(["Campanha", "Período", "Verba"], [(c[0], c[1], brl(c[2])) for c in CAMP], [2.2, 1.3, 1.1])
pdf.save(OUT / "Marketing" / "Plano de Marketing 2026.pdf")
q("Marketing", "Qual campanha trouxe mais leads esse ano?", ["S[ãa]o Jo[ãa]o"])
q("Marketing", "Qual é a verba anual de marketing?", [money_re(CENTROS[2][2])])

# ================================================================ Compras
fh = [(f, cat, rnd.choice(["A", "A", "B", "B", "C"]), dt.date(2027, rnd.randint(1, 12), 1), c)
      for f, cat, c in [("Agro Sertão Grãos", "Mandioca e milho", "Cícero Lacerda"), ("Embalagens Recôncavo", "Embalagens plásticas", "Paula Ventura"),
                        ("Óleos Vale do Jacuípe", "Óleo vegetal", "Hamilton Seixas"), ("Café Planalto da Conquista", "Café verde", "Marta Quadros"),
                        ("Caixas Papelão Sul", "Caixas de papelão", "Davi Azevedo"), ("Química Limpa Bahia", "Produtos de limpeza industrial", "Rosa Peixoto"),
                        ("Mecânica Industrial Santa Rita", "Manutenção de máquinas", "Sandro Leite"), ("Sal Marinho Nordeste", "Sal e temperos", "Iara Bezerra")]]
xlsx(OUT / "Compras" / "Fornecedores Homologados.xlsx", [
    ("Homologados", ["Fornecedor", "Categoria", "Classificação (A/B/C)", "Homologação válida até", "Contato"], fh, {"D": DATA})])
pedidos = [(f"PC-2026-{900 + i}", rnd.choice(fh)[0], dt.date(2026, 9, rnd.randint(1, 30)), dt.date(2026, 10, rnd.randint(6, 30)),
            round(rnd.uniform(4_000, 120_000), 2), rnd.choice(["Aguardando entrega", "Aguardando entrega", "Entrega parcial"])) for i in range(14)]
xlsx(OUT / "Compras" / "Pedidos de Compra em Aberto.xlsx", [
    ("Em aberto", ["Pedido", "Fornecedor", "Emissão", "Entrega prevista", "Valor", "Situação"], pedidos, {"C": DATA, "D": DATA, "E": MOEDA})])
pdf = Pdf("Política de Compras e Alçadas", "Compras - versão 4.0 - vigente desde 01/01/2026")
pdf.h("1. Cotações")
pdf.bullets(["Até R$ 2.000,00: compra direta com 1 orçamento.", "De R$ 2.000,01 a R$ 30.000,00: mínimo de 3 cotações.",
             "Acima de R$ 30.000,00: 3 cotações e concorrência registrada no sistema, com parecer do comprador."])
pdf.h("2. Alçadas de aprovação")
pdf.table(["Valor do pedido", "Quem aprova"], [("Até R$ 10.000,00", "Coordenador de Compras"), ("De R$ 10.000,01 a R$ 100.000,00", "Gerente da área solicitante + Controller"),
                                               ("Acima de R$ 100.000,00", "Diretor-Geral")], [2, 2.5])
pdf.h("3. Fornecedores")
pdf.p("Só é permitido comprar de fornecedores homologados. A homologação vale 2 anos e exige certidões negativas, visita técnica (para matéria-prima) e avaliação da Qualidade.")
pdf.save(OUT / "Compras" / "Política de Compras e Alçadas.pdf")
q("Compras", "Quem precisa aprovar uma compra de 50 mil reais?", [r"Gerente", r"Controller"])
q("Compras", "Quantas cotações preciso para comprar algo de 5 mil?", [r"\b3\b|tr[êe]s"])
q("Compras", "Quantos pedidos de compra estão em aberto?", [r"\b14\b|catorze|quatorze"])

# ================================================================ Logística
frota = [("Caminhão VW 24.280", "RQA-1A23", 2019, 184_300, dt.date(2026, 10, 9)), ("Caminhão VW 24.280", "RQA-2B45", 2020, 151_870, dt.date(2026, 11, 20)),
         ("Caminhão Mercedes Atego 1719", "PLX-3C67", 2018, 236_510, dt.date(2026, 10, 16)), ("VUC Iveco Daily", "SBA-4D89", 2022, 88_240, dt.date(2027, 1, 12)),
         ("VUC Iveco Daily", "SBA-5E12", 2022, 92_115, dt.date(2026, 12, 5)), ("Furgão Fiat Ducato", "OZT-6F34", 2017, 274_900, dt.date(2026, 10, 2)),
         ("Empilhadeira a gás Hyster", "EMP-01", 2016, None, dt.date(2026, 10, 28)), ("Empilhadeira elétrica Still", "EMP-02", 2021, None, dt.date(2027, 2, 15))]
xlsx(OUT / "Logística" / "Frota.xlsx", [
    ("Frota", ["Veículo", "Placa / código", "Ano", "Km atual", "Próxima revisão"], frota, {"E": DATA})])
otif = [(MESES_NOME[m].capitalize(), rnd.randint(1450, 1820), round(rnd.uniform(0.9, 0.965), 4), round(rnd.uniform(0.008, 0.025), 4)) for m in range(9)]
otif[8] = ("Setembro", 1694, 0.874, 0.031)
xlsx(OUT / "Logística" / "Indicadores de Entrega 2026.xlsx", [
    ("OTIF mensal", ["Mês", "Entregas", "OTIF (no prazo e completo)", "Devoluções"], otif, {"C": PCT, "D": PCT}),
    ("Meta", ["Indicador", "Meta 2026"], [("OTIF", "95%"), ("Devoluções", "abaixo de 1,5%")], {})])
estoque = [(c, n, rnd.randint(200, 4000), rnd.choice([500, 800, 1000, 1500])) for c, n, _ in PRODUTOS]
estoque[1] = (estoque[1][0], estoque[1][1], 140, 600)
estoque[7] = (estoque[7][0], estoque[7][1], 310, 1000)
xlsx(OUT / "Logística" / "Estoque" / "Posição de Estoque - 30-09-2026.xlsx", [
    ("Produto acabado", ["Código", "Produto", "Saldo (caixas)", "Estoque mínimo (caixas)"], estoque, {})])
pdf = Pdf("Procedimento de Expedição", "Logística - PO-LOG-003 rev. 5")
pdf.bullets(["Os pedidos liberados pelo Comercial até 14h saem no dia seguinte; depois das 14h, em 2 dias úteis.",
             "O conferente confere lote e validade de cada palete e registra no coletor antes do carregamento.",
             "Produtos com menos de 60% da validade restante não são expedidos sem autorização da Qualidade.",
             "Avarias no transporte devem ser registradas no canhoto da nota e fotografadas pelo motorista."])
pdf.save(OUT / "Logística" / "Procedimento de Expedição.pdf")
abaixo = [e for e in estoque if e[2] < e[3]]
q("Logística", "Qual veículo da frota está com a revisão atrasada?", [r"OZT-?6F34|Ducato"])
q("Logística", "Como foi o OTIF de setembro?", [r"87[,.]4"])
q("Logística", "Quais produtos estão abaixo do estoque mínimo?", [re.escape(e[1].split()[0]) for e in abaixo][:1] + [r"5 kg|Farinha"])
q("Logística", "Até que horas o pedido precisa ser liberado para sair no dia seguinte?", [r"14\s*h|14:00|14 horas"])

# ================================================================ Produção
plano = [(dt.date(2026, 10, d), linha, prod, qt) for d in range(5, 31) if dt.date(2026, 10, d).weekday() < 5
         for linha, prod, qt in [("Linha 1", "Farinha de mandioca 1 kg", 9_000), ("Linha 2", rnd.choice(["Biscoito de polvilho 100 g", "Biscoito de goma 200 g"]), 6_500),
                                 ("Linha 3", "Café torrado e moído 250 g", 3_200)]]
xlsx(OUT / "Produção" / "Plano de Produção - Outubro 2026.xlsx", [
    ("Plano diário", ["Data", "Linha", "Produto", "Quantidade (unidades)"], plano, {"A": DATA})])
oee = [(MESES_NOME[m].capitalize(), *[round(rnd.uniform(0.66, 0.82), 3) for _ in range(3)], round(rnd.uniform(0.012, 0.03), 4)) for m in range(9)]
oee[8] = ("Setembro", 0.781, 0.612, 0.744, 0.024)
xlsx(OUT / "Produção" / "Indicadores de Produção 2026.xlsx", [
    ("OEE por linha", ["Mês", "OEE Linha 1", "OEE Linha 2", "OEE Linha 3", "Refugo geral"], oee, {"B": PCT, "C": PCT, "D": PCT, "E": PCT})])
paradas = [("Linha 2", dt.date(2026, 9, 3), 6.5, "Quebra da embaladora", "Manutenção corretiva"), ("Linha 2", dt.date(2026, 9, 17), 4.0, "Falta de embalagem", "Atraso do fornecedor Embalagens Recôncavo"),
           ("Linha 1", dt.date(2026, 9, 10), 1.5, "Troca de formato", "Setup programado"), ("Linha 3", dt.date(2026, 9, 22), 2.0, "Ajuste do torrador", "Manutenção preventiva"),
           ("Linha 2", dt.date(2026, 9, 25), 3.5, "Quebra da embaladora", "Manutenção corretiva")]
xlsx(OUT / "Produção" / "Paradas de Máquina - Set 2026.xlsx", [
    ("Paradas", ["Linha", "Data", "Horas paradas", "Motivo", "Observação"], paradas, {"B": DATA})])
q("Produção", "Qual linha teve o pior OEE em setembro e por quê?", [r"Linha 2", r"embaladora"])
q("Produção", "Quanto de farinha de 1 kg vamos produzir por dia em outubro?", [r"9\.?000"])

# ================================================================ Qualidade
recl = [(dt.date(2026, rnd.randint(1, 9), rnd.randint(1, 28)), rnd.choice(CLIENTES), rnd.choice([p[1] for p in PRODUTOS]),
         rnd.choice(["Embalagem rasgada", "Produto úmido", "Corpo estranho", "Sabor alterado", "Peso abaixo do declarado"]),
         rnd.choice(["Encerrada", "Encerrada", "Em análise"])) for _ in range(22)]
recl.sort()
motivos = {}
for r in recl:
    motivos[r[3]] = motivos.get(r[3], 0) + 1
top_motivo = max(motivos, key=motivos.get)
xlsx(OUT / "Qualidade" / "Reclamações de Clientes 2026.xlsx", [
    ("Reclamações", ["Data", "Cliente", "Produto", "Motivo", "Situação"], recl, {"A": DATA}),
    ("Por motivo", ["Motivo", "Quantidade"], sorted(motivos.items(), key=lambda x: -x[1]), {})])
pdf = Pdf("Relatório de Auditoria Interna 2026", "Qualidade - auditoria realizada de 08 a 10/09/2026")
pdf.p("Escopo: Boas Práticas de Fabricação nas linhas 1, 2 e 3, almoxarifado de matéria-prima e expedição.")
pdf.table(["Nº", "Não conformidade", "Área", "Prazo"], [("NC-01", "Registro de temperatura do torrador sem assinatura em 6 dias", "Produção - Linha 3", "31/10/2026"),
                                                      ("NC-02", "Sacarias de mandioca encostadas na parede do almoxarifado", "Almoxarifado", "15/10/2026"),
                                                      ("NC-03", "Lixeira sem tampa com pedal na área de embalagem", "Produção - Linha 2", "10/10/2026"),
                                                      ("NC-04", "Treinamento de BPF vencido para 5 operadores", "Produção", "09/11/2026")], [0.5, 3, 1.4, 0.9])
pdf.p("Resultado geral: 91% de conformidade (meta 90%). Próxima auditoria externa da certificação: março de 2027.")
pdf.save(OUT / "Qualidade" / "Relatório de Auditoria Interna 2026.pdf")
q("Qualidade", "Qual o motivo mais comum de reclamação dos clientes?", [re.escape(top_motivo)])
q("Qualidade", "Quantas não conformidades a auditoria interna encontrou?", [r"\b4\b|quatro"])

# ================================================================ SSMA
acid = [(dt.date(2026, 2, 12), "Produção", "Corte superficial na mão", "Sem afastamento"), (dt.date(2026, 5, 7), "Logística", "Entorse no tornozelo ao descer do caminhão", "Com afastamento (6 dias)"),
        (dt.date(2026, 8, 19), "Produção", "Queimadura leve no torrador", "Sem afastamento")]
ult = max(a[0] for a in acid)
xlsx(OUT / "SSMA" / "Acidentes e Incidentes 2026.xlsx", [
    ("Registros", ["Data", "Área", "Descrição", "Gravidade"], acid, {"A": DATA}),
    ("Indicadores", ["Indicador", "Valor"], [("Dias sem acidente com afastamento em 04/10/2026", (HOJE - acid[1][0]).days), ("Acidentes em 2026", len(acid)), ("Quase acidentes registrados", 17)], {})])
nr = [(p["nome"], p["setor"], nrn, venc) for p, nrn, venc in
      [(pessoas[40], "NR-11 Empilhadeira", dt.date(2026, 10, 14)), (pessoas[41], "NR-11 Empilhadeira", dt.date(2026, 10, 14)),
       (pessoas[3], "NR-12 Máquinas", dt.date(2026, 10, 30)), (pessoas[45], "NR-35 Trabalho em altura", dt.date(2026, 11, 22)),
       (pessoas[10], "NR-12 Máquinas", dt.date(2026, 12, 1))]]
xlsx(OUT / "SSMA" / "Treinamentos NR a Vencer.xlsx", [
    ("A vencer", ["Funcionário", "Setor", "Treinamento", "Vencimento"], nr, {"D": DATA})])
q("SSMA", "Há quantos dias estamos sem acidente com afastamento?", [rf"\b{(HOJE - acid[1][0]).days}\b"])
q("SSMA", "Quem está com o treinamento de empilhadeira vencendo?", [re.escape(nr[0][0].split()[0])])

# ================================================================ TI
inv = []
for i in range(1, 46):
    tipo = rnd.choice(["Notebook", "Notebook", "Desktop", "Desktop", "Impressora", "Coletor de dados"])
    inv.append((f"PAT-{i:04d}", tipo, rnd.choice(["Dell", "Lenovo", "HP", "Zebra"] if tipo != "Impressora" else ["HP", "Epson"]),
                rnd.choice(list(SETORES_PESSOAL)), rnd.randint(2018, 2026), "Em uso" if rnd.random() > 0.1 else "Em manutenção"))
ate2019 = sum(1 for r in inv if r[4] <= 2019 and r[1] in ("Notebook", "Desktop"))
xlsx(OUT / "TI" / "Inventário de Equipamentos.xlsx", [
    ("Equipamentos", ["Patrimônio", "Tipo", "Marca", "Setor", "Ano de compra", "Situação"], inv, {})])
cham = [(f"CH-{5200 + i}", dt.date(2026, 9, rnd.randint(1, 30)), rnd.choice(list(SETORES_PESSOAL)),
         rnd.choice(["Senha bloqueada", "Impressora", "ERP lento", "Acesso a pasta", "E-mail", "Coletor sem sinal"]),
         rnd.choice(["Resolvido", "Resolvido", "Resolvido", "Aberto"])) for i in range(64)]
cat = {}
for c in cham:
    cat[c[3]] = cat.get(c[3], 0) + 1
top_cat = max(cat, key=cat.get)
abertos = sum(1 for c in cham if c[4] == "Aberto")
xlsx(OUT / "TI" / "Chamados - Setembro 2026.xlsx", [
    ("Chamados", ["Chamado", "Abertura", "Setor", "Categoria", "Situação"], cham, {"B": DATA}),
    ("Por categoria", ["Categoria", "Quantidade"], sorted(cat.items(), key=lambda x: -x[1]), {})])
pdf = Pdf("Política de Segurança da Informação", "TI - versão 1.4 - vigente desde 15/04/2026")
pdf.h("Senhas")
pdf.bullets(["Mínimo de 12 caracteres, com letras, números e símbolo.", "Troca obrigatória a cada 90 dias; não pode repetir as últimas 5.",
             "Após 5 tentativas erradas a conta é bloqueada por 15 minutos. Para desbloquear antes, abra chamado no ramal 2800."])
pdf.h("Uso de equipamentos")
pdf.bullets(["É proibido instalar programas sem autorização da TI.", "Pendrives são bloqueados; use a pasta da rede do seu setor.",
             "Backups das pastas da rede são feitos todos os dias às 23h e guardados por 30 dias."])
pdf.save(OUT / "TI" / "Política de Segurança da Informação.pdf")
q("TI", "Qual foi o tipo de chamado mais comum em setembro?", [re.escape(top_cat)])
q("TI", "Quantos caracteres a senha precisa ter?", [r"\b12\b|doze"])
q("TI", "Quantos chamados ainda estão abertos de setembro?", [rf"\b{abertos}\b"])

# ================================================================ Jurídico
contratos = [("Locação do galpão de expedição", "Imobiliária Portal do Sertão", dt.date(2024, 11, 1), dt.date(2026, 10, 31), 18_500.0, "Renovação em negociação"),
             ("Manutenção das caldeiras", "Mecânica Industrial Santa Rita", dt.date(2025, 1, 15), dt.date(2027, 1, 14), 7_200.0, "Vigente"),
             ("Licença do ERP", "Sistema Gestor Nordeste", dt.date(2023, 3, 1), dt.date(2027, 2, 28), 12_900.0, "Vigente"),
             ("Transporte de cargas fracionadas", "Transportadora Rota Leste", dt.date(2025, 6, 1), dt.date(2026, 11, 30), 46_000.0, "Vigente - avisar 30 dias antes"),
             ("Vigilância patrimonial", "Guarda Forte Segurança", dt.date(2024, 4, 1), dt.date(2027, 3, 31), 21_300.0, "Vigente"),
             ("Agência de publicidade", "Agência Farol Criativo", dt.date(2026, 1, 1), dt.date(2026, 12, 31), 15_000.0, "Vigente")]
xlsx(OUT / "Jurídico" / "Contratos Vigentes.xlsx", [
    ("Contratos", ["Objeto", "Contratado", "Início", "Término", "Valor mensal", "Situação"], contratos, {"C": DATA, "D": DATA, "E": MOEDA})])
proc = [("0001234-55.2025.5.05.0193", "Trabalhista", "Ex-motorista", "Horas extras e férias não gozadas", 85_000.0, "Provável"),
        ("0004567-11.2025.5.05.0193", "Trabalhista", "Ex-auxiliar de produção", "Adicional de insalubridade", 42_000.0, "Possível"),
        ("8000123-44.2026.8.05.0080", "Cível", "Cliente Mercadinho São Jorge", "Cobrança de duplicatas (a empresa é autora)", 63_400.0, "Ativo a receber"),
        ("0007890-22.2026.5.05.0193", "Trabalhista", "Ex-vendedora", "Comissões e verbas rescisórias", 58_000.0, "Possível")]
xlsx(OUT / "Jurídico" / "Processos Judiciais.xlsx", [
    ("Processos", ["Número", "Tipo", "Parte contrária", "Assunto", "Valor da causa", "Risco"], proc, {"E": MOEDA})])
q("Jurídico", "Qual contrato vence primeiro?", [r"galp[ãa]o|Loca[çc][ãa]o", r"31/10"])
q("Jurídico", "Quantos processos trabalhistas a empresa tem?", [r"\b3\b|tr[êe]s"], "distrator: 'férias' aparece num processo, não confundir com RH")

# ================================================================ Fiscal
obrig = [("ICMS - apuração de setembro", dt.date(2026, 10, 9)), ("DCTFWeb - setembro", dt.date(2026, 10, 15)), ("EFD-Contribuições - agosto", dt.date(2026, 10, 14)),
         ("PIS/COFINS - setembro", dt.date(2026, 10, 23)), ("IRPJ/CSLL - estimativa mensal", dt.date(2026, 10, 30)), ("FGTS Digital - setembro", dt.date(2026, 10, 20))]
xlsx(OUT / "Fiscal" / "Calendário de Obrigações - Outubro 2026.xlsx", [
    ("Outubro", ["Obrigação", "Vencimento", "Responsável"], [(o, d, GESTORES["Fiscal"][0]) for o, d in sorted(obrig, key=lambda x: x[1])], {"B": DATA})])
imp = [("ICMS", 612_480.37), ("PIS", 61_210.90), ("COFINS", 281_940.15), ("IRPJ (estimativa)", 98_300.00), ("CSLL (estimativa)", 37_150.00), ("INSS patronal", 214_660.42)]
xlsx(OUT / "Fiscal" / "Apuração de Impostos - Set 2026.xlsx", [
    ("Setembro 2026", ["Tributo", "Valor apurado"], imp + [("TOTAL", round(sum(v for _, v in imp), 2))], {"B": MOEDA})])
q("Fiscal", "Qual é o próximo imposto a vencer?", [r"ICMS", r"09/10|9 de outubro"])
q("Fiscal", "Quanto deu o ICMS de setembro?", [money_re(612_480.37)])

# ================================================================ Diretoria
pdf = Pdf("Planejamento Estratégico 2026-2028", "Diretoria - aprovado em 05/12/2025")
pdf.h("Missão")
pdf.p("Levar à mesa do nordestino alimentos tradicionais de qualidade, com preço justo e respeito ao produtor local.")
pdf.h("Metas para 2028")
pdf.bullets(["Faturamento de R$ 95 milhões por ano (2025: R$ 59 milhões).", "Margem EBITDA de 14%.",
             "Entrar em Sergipe e Alagoas com centro de distribuição próprio até 2027.", "OTIF acima de 95% e zero acidente com afastamento."])
pdf.h("Projetos prioritários de 2026")
pdf.table(["Projeto", "Responsável", "Prazo"], [("Nova linha de café em cápsula", GESTORES["Produção"][0], "jun/2027"),
                                              ("Troca do ERP", GESTORES["TI"][0], "mar/2027"), ("CD em Aracaju", GESTORES["Logística"][0], "dez/2027"),
                                              ("Programa de trainees", GESTORES["RH"][0], "jan/2027")], [2.2, 2, 0.8])
pdf.save(OUT / "Diretoria" / "Planejamento Estratégico 2026-2028.pdf")
pdf = Pdf("Ata da Reunião de Diretoria - 15/09/2026", "Diretoria - reunião ordinária mensal")
pdf.p(f"Presentes: {GESTORES['Diretoria'][0]} (Diretor-Geral), {GESTORES['Controladoria'][0]}, {GESTORES['Comercial'][0]}, {GESTORES['Produção'][0]}, {GESTORES['RH'][0]}.")
pdf.h("Decisões")
pdf.bullets(["Aprovado o reajuste médio de 4,5% na tabela de preços a partir de 01/10/2026.",
             "Adiada para novembro a campanha de Natal, para concentrar verba na Feira Bahia Food em outubro.",
             "Aprovada a compra de uma nova embaladora para a Linha 2, até R$ 380.000,00, com entrega prevista para janeiro de 2027.",
             "O RH vai abrir 6 vagas de operador de produção para o turno da noite a partir de novembro."])
pdf.h("Próxima reunião")
pdf.p("13/10/2026, às 9h, na sala da Diretoria.")
pdf.save(OUT / "Diretoria" / "Atas" / "Ata Reunião de Diretoria - 15-09-2026.pdf")
q("Diretoria", "Qual é a meta de faturamento para 2028?", [r"95"])
q("Diretoria", "O que a diretoria decidiu na última reunião?", [r"embaladora", r"4,5"])
q("Diretoria", "Quando é a próxima reunião da diretoria?", [r"13/10|13 de outubro"])

# ================================================================ Administrativo (contatos)
xlsx(OUT / "Administrativo" / "Lista de Ramais e Responsáveis.xlsx", [
    ("Ramais", ["Setor", "Responsável", "Cargo", "Ramal"], [(s, *v) for s, v in GESTORES.items()] +
     [("Departamento Pessoal", "Equipe DP", "Folha de pagamento e férias", "2204"), ("Suporte de TI", "Equipe de TI", "Chamados", "2800"), ("Portaria", "Recepção", "Visitantes e entregas", "2000")], {})])
pdf = Pdf("Regras do Escritório e da Portaria", "Administrativo")
pdf.bullets(["Horário administrativo: 8h às 17h48, de segunda a sexta, com 1 hora de almoço.", "Visitantes precisam ser avisados à portaria (ramal 2000) com antecedência.",
             "Salas de reunião são reservadas pelo calendário do e-mail; a sala da Diretoria precisa de autorização da secretaria.",
             "O estacionamento interno é exclusivo para gestores, visitantes e veículos da frota."])
pdf.save(OUT / "Administrativo" / "Regras do Escritório e da Portaria.pdf")
q("Administrativo", "Qual é o ramal do suporte de TI?", [r"2800"])
q("Administrativo", "Quem é o gerente de logística?", [re.escape(GESTORES["Logística"][0].split()[0])])
q("Administrativo", "Qual o horário de trabalho do administrativo?", [r"17h?:?48"])

# ---------------------------------------------------------------- saída
leia = OUT / "LEIA-ME.txt"
leia.write_text(
    f"{EMPRESA} (EMPRESA FICTÍCIA)\n\nAcervo simulado para testar a Aurora: cada pasta é um setor.\n"
    "Todos os nomes, valores, CNPJs e pessoas foram inventados. Data de referência: 04/10/2026.\n"
    f"Gerado por Harness_Aurora/scripts/gerar_empresa_ia.py em {dt.datetime.now():%d/%m/%Y %H:%M}.\n", encoding="utf-8")
Path(args.questions).write_text(json.dumps({"empresa": EMPRESA, "hoje": HOJE.isoformat(), "pasta": str(OUT),
                                            "perguntas": QUESTIONS}, ensure_ascii=False, indent=2), encoding="utf-8")
arquivos = [p for p in OUT.rglob("*") if p.is_file()]
setores = sorted({p.relative_to(OUT).parts[0] for p in arquivos if len(p.relative_to(OUT).parts) > 1})
print(f"{len(arquivos)} arquivos em {len(setores)} setores: {', '.join(setores)}")
print(f"{len(QUESTIONS)} perguntas em {args.questions}")
