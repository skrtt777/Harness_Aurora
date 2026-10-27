import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { openExternalUrl, type LiveCheck, type Proof } from './api';
import { ProofMark, remarkProof } from './Proof';

export default function Markdown({ children, proof, live }: { children: string; proof?: Proof | null; live?: LiveCheck | null }) {
  return <div className="aurora-markdown"><ReactMarkdown remarkPlugins={proof ? [remarkGfm, remarkProof(proof)] : [remarkGfm]} skipHtml components={{
    a: ({ href, children }) => <a href={href} onClick={event => {
      event.preventDefault();
      if (href && /^https?:\/\//i.test(href)) void openExternalUrl(href);
    }}>{children}</a>,
    img: ({ alt }) => <span>{alt || 'Imagem'}</span>,
    // A number of the comprovante (remarkProof marks it).
    mark: ({ node, children, ...rest }) => {
      const index = Number((node?.properties as Record<string, unknown> | undefined)?.dataProof ?? (rest as Record<string, unknown>)['data-proof']);
      const claim = proof?.claims[index];
      return claim ? <ProofMark claim={claim} live={live?.claims.find((c) => c.i === index)}>{children}</ProofMark> : <mark>{children}</mark>;
    },
  }}>{children}</ReactMarkdown></div>;
}
