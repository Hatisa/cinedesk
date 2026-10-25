import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

interface ToastMsg {
  id: number;
  text: string;
}

const ToastCtx = createContext<((text: string) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<ToastMsg[]>([]);

  const show = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setList((prev) => [...prev, { id, text }]);
    setTimeout(() => setList((prev) => prev.filter((t) => t.id !== id)), 2000);
  }, []);

  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toast-wrap">
        {list.map((t) => (
          <div className="toast" key={t.id}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): (text: string) => void {
  const fn = useContext(ToastCtx);
  return fn ?? (() => undefined);
}
