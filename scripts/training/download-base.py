"""Download immutable official base revision; never execute remote model code."""
import json
from pathlib import Path
from huggingface_hub import HfApi, snapshot_download

root = Path('models/local-training')
root.mkdir(parents=True, exist_ok=True)
repo = 'Qwen/Qwen2.5-Coder-1.5B-Instruct'
info = HfApi().model_info(repo)
destination = root / 'base'
snapshot_download(repo, revision=info.sha, local_dir=destination,
                  allow_patterns=['*.json', '*.safetensors', '*.txt', '*.md', 'LICENSE', '*.model'])
(root / 'base-provenance.json').write_text(json.dumps({'repo': repo, 'revision': info.sha}, indent=2))
print(json.dumps({'base': str(destination), 'revision': info.sha}))
