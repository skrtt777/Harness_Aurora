// Maintainer-only: turn an inert public contribution into a reviewable data PR.
// Never execute contribution text, checkout contributor code, or auto-merge.
import { githubApi } from '../../app/centralGitHub.js';
import { CENTRAL_REPO, parseContribution, validateManifest, centralManifest, sha256 } from '../../app/centralProtocol.js';
import { pathToFileURL } from 'node:url';

export async function prepareCentralReview(issueNumber, api = githubApi) {
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) throw new Error('Informe um número de issue positivo.');
  const repository = await api(`repos/${CENTRAL_REPO}`);
  if (!repository.permissions?.push) throw new Error('A revisão requer acesso de escrita do mantenedor.');
  const issue = await api(`repos/${CENTRAL_REPO}/issues/${issueNumber}`);
  if (issue.pull_request || issue.state !== 'open') throw new Error('A contribuição precisa ser uma issue aberta.');
  const payload = parseContribution(issue.body);
  const branch = `central-memory/issue-${issueNumber}-${payload.id.slice(0,12)}`;
  const prs = await api(`repos/${CENTRAL_REPO}/pulls?state=all&head=${encodeURIComponent(CENTRAL_REPO.split('/')[0]+':'+branch)}`);
  if (prs.length) return { url: prs[0].html_url, existing: true };
  const prBody = {title:`Memória central: contribuição #${issueNumber}`,head:branch,base:'main',body:`Adiciona uma referência pública proposta na issue #${issueNumber}.\n\nRevisar conteúdo, privacidade, procedência e correção técnica antes de fazer merge. A validação de formato não comprova qualidade. Nenhum código da contribuição foi executado.\n\nHash do conteúdo: ${payload.id}.\n\nCloses #${issueNumber}`};
  const matching = await api(`repos/${CENTRAL_REPO}/git/matching-refs/heads/${branch}`);
  if (matching.some(ref => ref.ref === 'refs/heads/' + branch)) {
    const pr = await api(`repos/${CENTRAL_REPO}/pulls`, {method:'POST',body:prBody});
    return {url:pr.html_url,recovered:true};
  }
  const head = await api(`repos/${CENTRAL_REPO}/git/ref/heads/main`);
  const commit = await api(`repos/${CENTRAL_REPO}/git/commits/${head.object.sha}`);
  const file = await api(`repos/${CENTRAL_REPO}/contents/central-memories/manifest.json?ref=${head.object.sha}`);
  const manifest = validateManifest(JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')));
  const id = 'memory-' + payload.id;
  if (manifest.bundles.some(b => b.id === id)) return { alreadyPublished: true, id };
  const bundle = JSON.stringify({ format:'aurora-central-bundle', version:1, memories:[{ id:payload.id, ...payload.memory, issue:issueNumber }] }, null, 2) + '\n';
  const bundles = [...manifest.bundles, {id,file:id+'.json',sha256:sha256(bundle),count:1}];
  const nextManifest = centralManifest(bundles);
  validateManifest(nextManifest);
  const entries = [];
  for (const [path, content] of [[`central-memories/${id}.json`,bundle],['central-memories/manifest.json',JSON.stringify(nextManifest,null,2)+'\n']]) {
    const blob = await api(`repos/${CENTRAL_REPO}/git/blobs`, {method:'POST',body:{content,encoding:'utf-8'}});
    entries.push({path,mode:'100644',type:'blob',sha:blob.sha});
  }
  const tree = await api(`repos/${CENTRAL_REPO}/git/trees`, {method:'POST',body:{base_tree:commit.tree.sha,tree:entries}});
  const next = await api(`repos/${CENTRAL_REPO}/git/commits`, {method:'POST',body:{message:`Propõe memória central da contribuição #${issueNumber}`,tree:tree.sha,parents:[head.object.sha]}});
  // Only a new branch is created. Main changes only when a maintainer merges the PR.
  await api(`repos/${CENTRAL_REPO}/git/refs`, {method:'POST',body:{ref:'refs/heads/'+branch,sha:next.sha}});
  const pr = await api(`repos/${CENTRAL_REPO}/pulls`, {method:'POST',body:prBody});
  return {url:pr.html_url,existing:false};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await prepareCentralReview(Number(process.argv[2] || process.env.CENTRAL_ISSUE)), null, 2));
}
