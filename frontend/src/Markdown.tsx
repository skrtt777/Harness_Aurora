import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { openExternalUrl } from './api';

export default function Markdown({ children }: { children: string }) {
  return <div className="aurora-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
    a: ({ href, children }) => <a href={href} onClick={event => {
      event.preventDefault();
      if (href && /^https?:\/\//i.test(href)) void openExternalUrl(href);
    }}>{children}</a>,
    img: ({ alt }) => <span>{alt || 'Imagem'}</span>,
  }}>{children}</ReactMarkdown></div>;
}
