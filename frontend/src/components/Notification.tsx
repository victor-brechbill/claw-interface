import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
} from "react";
import type { ReactNode } from "react";
import type { Notification } from "../types";

interface NotificationContextType {
  notify: (type: Notification["type"], message: string) => void;
}

const NotificationContext = createContext<NotificationContextType>({
  notify: () => {},
});

// eslint-disable-next-line react-refresh/only-export-components
export function useNotification() {
  return useContext(NotificationContext);
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  // Move nextId inside the provider to avoid fast refresh issues
  const nextIdRef = useRef(0);

  const notify = useCallback((type: Notification["type"], message: string) => {
    const id = ++nextIdRef.current;
    const n: Notification = { id, type, message };
    setNotifications((prev) => [...prev, n]);
    setTimeout(() => {
      setNotifications((prev) => prev.filter((item) => item.id !== id));
    }, 5000);
  }, []);

  const dismiss = useCallback((id: number) => {
    setNotifications((prev) => prev.filter((item) => item.id !== id));
  }, []);

  return (
    <NotificationContext.Provider value={{ notify }}>
      {children}
      <div className="notification-container">
        {notifications.map((n) => (
          <div key={n.id} className={`notification notification-${n.type}`}>
            <span>{n.message}</span>
            <button
              className="notification-dismiss"
              onClick={() => dismiss(n.id)}
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </NotificationContext.Provider>
  );
}
