import { useEffect, useRef, useState } from 'react';
import { deriveAIState, useFriday } from '../../store/useFriday';
import { useNow, useOrch, usePresence } from '../hooks';
import { Icon } from '../icons';
import { AIStatus } from '../panels/TopBar';

const HINTS = ['これは何？', 'これについて調べて', '明日の天気は？', '写真撮って', '去年撮った東京の夜景', '駅までナビして'];

function Wave({ n = 7 }: { n?: number }) {
  return (
    <span className="wave" aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} style={{ animationDelay: `${i * 0.08}s` }} />
      ))}
    </span>
  );
}

/**
 * Conversation HUD: live transcript, streaming reply, attachments. Appears
 * only while a conversation is active; tap the reply to barge in.
 */
export function VoiceConsole() {
  const orch = useOrch();
  const now = useNow(1000);
  const listening = useFriday((s) => s.listening);
  const partial = useFriday((s) => s.partial);
  const draft = useFriday((s) => s.draft);
  const speaking = useFriday((s) => s.speaking);
  const busy = useFriday((s) => s.busy);
  const conv = useFriday((s) => s.conversation);
  const ai = useFriday((s) => deriveAIState(s));
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const [hint, setHint] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = setInterval(() => setHint((h) => (h + 1) % HINTS.length), 3200);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (typing) input.current?.focus();
  }, [typing]);

  const lastUser = [...conv].reverse().find((m) => m.role === 'user');
  const lastBot = conv[conv.length - 1]?.role === 'assistant' ? conv[conv.length - 1] : null;
  const recent = lastBot && now - lastBot.ts < 9000;
  const active = listening || !!partial || !!busy || !!draft || speaking || !!recent || typing;
  const replyText = draft || (busy ? '' : speaking || recent ? lastBot?.text ?? '' : '');
  const replyPhase = usePresence(!!replyText || !!busy);
  const sttLive = listening && !!partial;

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    setTyping(false);
    void orch.ask(t);
  };

  const utterText = partial || (active && lastUser ? lastUser.text : '');

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {replyPhase && (
        <div
          className="panel cyan reply"
          data-presence={replyPhase}
          onClick={() => speaking && orch.interrupt()}
          role={speaking ? 'button' : undefined}
          aria-label={speaking ? 'タップで割り込み' : undefined}
        >
          <div className="speaking-row">
            <AIStatus compact />
            {speaking && (
              <span className="faint mono" style={{ fontSize: 10 }}>
                TAP TO INTERRUPT
              </span>
            )}
          </div>
          {replyText}
          {(draft || busy) && <span className="cursor" />}
          {lastBot?.attachment && !draft && !busy && <Attachment kind={lastBot.attachment.kind} />}
        </div>
      )}
      {typing ? (
        <form
          className="utter live"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <span className="ic">
            <Icon.Keyboard size={15} />
          </span>
          <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="F.R.I.D.A.Y. に質問…" enterKeyHint="send" onBlur={() => !text && setTyping(false)} />
          <button type="submit" className="ok" aria-label="送信">
            <Icon.Check size={18} />
          </button>
        </form>
      ) : (
        <div className={`utter ${sttLive || listening ? 'live' : ''}`} onClick={() => setTyping(true)} role="button" aria-label="テキストで質問">
          <span className="ic">{listening ? <Wave n={5} /> : <Icon.Wave size={16} />}</span>
          {utterText ? (
            <span className="txt">{utterText}</span>
          ) : (
            <span className="txt ph">{listening ? '聞いています…' : `「${HINTS[hint]}」`}</span>
          )}
          {!partial && lastUser && active && ai !== 'LISTENING' && (
            <span className="ok">
              <Icon.Check size={18} />
            </span>
          )}
          {!utterText && (
            <span className="faint">
              <Icon.Keyboard size={16} />
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Attachment({ kind }: { kind: string }) {
  const orch = useOrch();
  const map: Record<string, [string, () => void]> = {
    search: ['SOURCES ▸', () => orch.openSheet('search')],
    memory: ['MEMORY ▸', () => orch.openSheet('memory')],
    social: ['DRAFT ▸', () => orch.openSheet('social')],
  };
  const a = map[kind];
  if (!a) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <button
        className="chip orange"
        onClick={(e) => {
          e.stopPropagation();
          a[1]();
        }}
      >
        {a[0]}
      </button>
    </div>
  );
}
