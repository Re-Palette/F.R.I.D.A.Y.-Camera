import { useFriday } from '../store/useFriday';

export function Toasts() {
  const toasts = useFriday((s) => s.toasts);
  const countdown = useFriday((s) => s.countdown);
  return (
    <>
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
      {countdown != null && (
        <div key={countdown} className="countdown">
          {countdown}
        </div>
      )}
    </>
  );
}
