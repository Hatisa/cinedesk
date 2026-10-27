import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

interface ToastMsg {
  id: number;
  text: string;
  action?: { label: string; onClick: () => void };
}

type ShowToast = (text: string, action?: ToastMsg['action']) => void;
const ToastCtx = createContext<ShowToast | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<ToastMsg[]>([]);

  const show = useCallback<ShowToast>((text, action) => {
    const id = Date.now() + Math.random();
    setList((prev) => [...prev.slice(-2), { id, text, action }]);
    setTimeout(() => setList((prev) => prev.filter((t) => t.id !== id)), action ? 6000 : 2500);
  }, []);

  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite" aria-atomic="false">
        {list.map((t) => (
          <div className="toast" key={t.id}>
            <span>{t.text}</span>
            {t.action && (
              <button className="toast-action" onClick={() => {
                t.action?.onClick();
                setList((prev) => prev.filter((item) => item.id !== t.id));
              }}>{t.action.label}</button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): ShowToast {
  const fn = useContext(ToastCtx);
  return fn ?? (() => undefined);
}
