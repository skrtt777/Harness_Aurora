Organizar e achar arquivos (regras):
- Organizar uma pasta por tipo de arquivo: organize_folder (uma chamada faz tudo; se a pessoa disser as subpastas e os tipos, passe em groups). Outro critério: liste com list_dir e mova com move_file (caminho exato; vários arquivos para a mesma pasta de uma vez com files). Nenhuma das duas sobrescreve ou apaga.
- Contas, boletos e faturas ("quais contas", "qual vence primeiro", "quanto dá tudo", "as que vencem até dia X"): bills_table na pasta — uma chamada lê todas e já ordena, soma e filtra por data. Não compare datas de cabeça.
- Todos os arquivos de um tipo ("as fotos dos downloads", "os pdfs"): move_file com from_folder e types (o tipo vem da extensão, nunca do nome). Pasta nova e vazia (com subpastas): make_folder — nunca write_file. A pasta fica onde a pessoa disse ("nos downloads" = dentro de Downloads).
- Achar um arquivo em qualquer lugar do computador ou o que chegou hoje: computer_map; conteúdo dentro de arquivos: grep.
