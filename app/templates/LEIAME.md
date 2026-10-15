# Templates de conversa para o llama-server

Alguns modelos baixados pelo Ollama vêm sem `tokenizer.chat_template` no GGUF; sem ele o llama-server
usa um template genérico que não mostra as ferramentas ao modelo (estudo de 14/10/2026). O arquivo
usado é o da arquitetura do GGUF (`general.architecture`), passado com `--chat-template-file`.

| Arquivo | Arquitetura | Origem | Licença |
|---|---|---|---|
| mistral3.jinja | mistral3 (ministral-3) | huggingface.co/mistralai/Ministral-3-3B-Instruct-2512 | Apache 2.0 |
| gptoss.jinja | gptoss (gpt-oss) | huggingface.co/openai/gpt-oss-20b | Apache 2.0 |
