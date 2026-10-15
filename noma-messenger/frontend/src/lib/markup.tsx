import { Fragment, type ReactNode, useState } from 'react';

/**
 * Tiny Telegram-flavoured markup:
 * **bold**  __italic__  ~~strike~~  `code`  ```pre```  ||spoiler||  links  @mentions
 */

type Rule = { re: RegExp; render: (m: RegExpExecArray, key: string, inner: (s: string, k: string) => ReactNode[]) => ReactNode };

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/;

function Spoiler({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <span
      className={`md-spoiler${shown ? ' shown' : ''}`}
      onClick={(e) => {
        if (!shown) {
          e.stopPropagation();
          setShown(true);
        }
      }}
    >
      {children}
    </span>
  );
}

const RULES: Rule[] = [
  { re: /```(?:\w+\n)?([\s\S]+?)```/, render: (m, k) => <pre key={k} className="md-pre">{m[1].replace(/^\n|\n$/g, '')}</pre> },
  { re: /`([^`\n]+)`/, render: (m, k) => <code key={k} className="md-code">{m[1]}</code> },
  { re: /\*\*([\s\S]+?)\*\*/, render: (m, k, inner) => <strong key={k}>{inner(m[1], k)}</strong> },
  { re: /__([\s\S]+?)__/, render: (m, k, inner) => <em key={k}>{inner(m[1], k)}</em> },
  { re: /~~([\s\S]+?)~~/, render: (m, k, inner) => <s key={k}>{inner(m[1], k)}</s> },
  { re: /\|\|([\s\S]+?)\|\|/, render: (m, k, inner) => <Spoiler key={k}>{inner(m[1], k)}</Spoiler> },
  {
    re: URL_RE,
    render: (m, k) => (
      <a key={k} href={m[1]} target="_blank" rel="noopener noreferrer" className="md-link" onClick={(e) => e.stopPropagation()}>
        {m[1].replace(/^https?:\/\//, '').slice(0, 60)}
        {m[1].replace(/^https?:\/\//, '').length > 60 ? '…' : ''}
      </a>
    ),
  },
  { re: /(^|[^\w])(@[a-zA-Z][\w]{3,31})/, render: (m, k) => <Fragment key={k}>{m[1]}<span className="md-mention">{m[2]}</span></Fragment> },
];

function parse(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let i = 0;
  while (rest) {
    let best: { idx: number; m: RegExpExecArray; rule: Rule } | null = null;
    for (const rule of RULES) {
      const m = rule.re.exec(rest);
      if (m && (best === null || m.index < best.idx)) best = { idx: m.index, m, rule };
    }
    if (!best) {
      out.push(rest);
      break;
    }
    if (best.idx > 0) out.push(rest.slice(0, best.idx));
    const key = `${keyPrefix}.${i++}`;
    out.push(best.rule.render(best.m, key, parse));
    rest = rest.slice(best.idx + best.m[0].length);
  }
  return out;
}

export function RichText({ text, highlight }: { text: string; highlight?: string }) {
  if (highlight) {
    const q = highlight.toLowerCase();
    const parts: ReactNode[] = [];
    let idx = 0;
    const lower = text.toLowerCase();
    let pos = lower.indexOf(q);
    while (pos !== -1 && q) {
      parts.push(text.slice(idx, pos));
      parts.push(<mark key={pos} className="md-mark">{text.slice(pos, pos + q.length)}</mark>);
      idx = pos + q.length;
      pos = lower.indexOf(q, idx);
    }
    parts.push(text.slice(idx));
    return <>{parts}</>;
  }
  return <>{parse(text, 'r')}</>;
}
