import { useCallback, useEffect, useState } from 'react';
import { canOpenFiles, getComputerMap, getMapChildren, openDeliveredFile, searchComputerMap, setComputerMap, showDeliveredFile, type MapNode, type MapStatus } from './api';
import Icon from './Icon';

const KIND: Record<string, string> = {
  projeto: 'Projeto', fotos: 'Fotos', videos: 'Vídeos', musicas: 'Músicas', documentos: 'Documentos', financeiro: 'Contas',
  downloads: 'Downloads', instaladores: 'Instaladores', compactados: 'Compactados', jogos: 'Jogos',
};
const ago = (iso: string | null) => {
  if (!iso) return '';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return min < 1 ? 'agora' : min < 60 ? `há ${min} min` : min < 1440 ? `há ${Math.round(min / 60)} h` : `há ${Math.round(min / 1440)} dia(s)`;
};

/** One folder of the map: name, what it is, how big against its siblings, and its subfolders on demand. */
function MapBranch({ node, largest }: { node: MapNode; largest: number }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<MapNode[] | null>(null);
  const toggle = () => {
    if (!open && !children) void getMapChildren(node.path).then(setChildren).catch(() => setChildren([]));
    setOpen(!open);
  };
  const big = largest > 0 && node.bytes / largest >= 0.5; // the biggest ones among their siblings stand out
  const head = <>
    <span className="map-caret" aria-hidden="true">{node.subdirs ? (open ? '▾' : '▸') : ''}</span>
    <span className="map-name">{node.name}</span>
    {node.kind && <span className="map-kind">{(node.label || KIND[node.kind] || node.kind).replace(/ · \d+.*$/, '')}</span>}
    <span className={`map-meta ${big ? 'is-big' : ''}`}>{node.files.toLocaleString('pt-BR')} arquivos · {node.size}</span>
  </>;
  return <li className="map-branch">
    {node.subdirs
      ? <button type="button" className="map-node" aria-expanded={open} onClick={toggle} title={node.path}>{head}</button>
      : <div className="map-node is-leaf" title={node.path}>{head}</div>}
    {open && children && (children.length
      ? <ul className="map-tree">{children.map((c) => <MapBranch key={c.path} node={c} largest={Math.max(...children.map((x) => x.bytes), 1)} />)}</ul>
      : <p className="map-empty">Sem subpastas mapeadas.</p>)}
  </li>;
}

/**
 * Configurações → Pastas: the Aurora learns how the computer is organized (names, types, sizes and
 * dates only; no file is opened), to know where projects, photos and documents are and find files
 * by name at once. It lives on this computer; turning it off deletes it.
 */
export default function ComputerMapPanel() {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<MapStatus | null>(null);
  const [roots, setRoots] = useState<MapNode[]>([]);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Awaited<ReturnType<typeof searchComputerMap>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const r = await getComputerMap();
    setEnabled(r.enabled); setStatus(r.status); setRoots(r.roots);
  }, []);
  useEffect(() => { void refresh().catch(() => setError('Não foi possível carregar o mapa.')); }, [refresh]);
  // Followed while it runs, and right after turning it on (until a first pass has finished).
  const following = Boolean(status?.running || (enabled && !status?.finishedAt && !roots.length));
  useEffect(() => {
    if (!following) return undefined;
    const id = setInterval(() => void refresh().catch(() => {}), 2000);
    return () => clearInterval(id);
  }, [following, refresh]);

  const toggle = (on: boolean) => {
    if (!on && !window.confirm('Desligar apaga o mapa do computador. A Aurora deixa de saber onde ficam as coisas (você pode ligar de novo depois).')) return;
    setBusy(true); setError('');
    void setComputerMap(on).then((r) => { setEnabled(r.enabled); setStatus(r.status); setRoots(r.roots); setFound(null); })
      .catch((e: Error) => setError(e.message)).finally(() => setBusy(false));
  };
  const search = (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) { setFound(null); return; }
    void searchComputerMap(q).then(setFound).catch(() => {});
  };
  const largest = Math.max(...roots.map((r) => r.bytes), 1);
  const openable = canOpenFiles();

  return <div className="computer-map" aria-label="Mapa do computador">
    <label className="folder-setup-toggle">
      <input type="checkbox" className="switch" checked={enabled} disabled={busy} onChange={(e) => toggle(e.target.checked)} />
      <span><strong>Conhecer a organização do meu computador</strong><small>A Aurora anota só os nomes, tipos, tamanhos e datas das suas pastas, sem abrir nenhum arquivo, para saber onde ficam seus projetos, fotos e documentos e achar qualquer arquivo pelo nome na hora. Windows, programas e senhas ficam de fora. Tudo fica neste computador, e desligar apaga o mapa.</small></span>
    </label>

    {enabled && status && <p className="map-status" role="status">
      {status.running
        ? `Mapeando… ${status.dirs.toLocaleString('pt-BR')} pastas e ${status.files.toLocaleString('pt-BR')} arquivos até agora. Isso roda devagar de propósito, para não pesar no computador.`
        : status.finishedAt
          ? `Mapa pronto: ${status.dirs.toLocaleString('pt-BR')} pastas, ${status.files.toLocaleString('pt-BR')} arquivos · atualizado ${ago(status.finishedAt)}. Ele se atualiza sozinho, só o que mudou.`
          : roots.length ? 'Mapa salvo. A próxima atualização começa em alguns minutos.' : 'O mapeamento começa em instantes.'}
      {status.error && <span className="settings-error"> {status.error}</span>}
    </p>}

    {enabled && roots.length > 0 && <>
      <input className="field" type="search" placeholder="Procurar um arquivo pelo nome em todo o computador" aria-label="Procurar no mapa" value={query} onChange={(e) => search(e.target.value)} />
      {found
        ? <ul className="map-results" aria-label="Resultados">
          {found.folders.length + found.files.length === 0 && <li className="map-empty">Nada com esse nome.</li>}
          {found.folders.map((f) => <li key={f.path}><Icon name="folder" size={13} /> <span className="mono">{f.path}</span>{f.kind && <span className="map-kind">{KIND[f.kind]}</span>}</li>)}
          {found.files.map((f) => <li key={f.path}>
            <span className="mono">{f.path}</span> <small>{f.size}{f.modified ? ` · ${new Date(f.modified).toLocaleDateString('pt-BR')}` : ''}</small>
            {openable && <span className="map-actions"><button type="button" className="btn btn-text btn-sm" onClick={() => void openDeliveredFile(f.path)}>Abrir</button><button type="button" className="btn btn-text btn-sm" onClick={() => void showDeliveredFile(f.path)}>Mostrar na pasta</button></span>}
          </li>)}
        </ul>
        : <ul className="map-tree map-roots" aria-label="Pastas do computador">{roots.map((r) => <MapBranch key={r.path} node={r} largest={largest} />)}</ul>}
    </>}
    {error && <p role="alert" className="settings-error">{error}</p>}
  </div>;
}
