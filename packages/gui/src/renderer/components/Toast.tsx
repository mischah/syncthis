import { useEffect, useState } from 'react';
import './Toast.css';

interface ToastProps {
  message: string;
  variant?: 'success' | 'error';
  onDone: () => void;
}

export function Toast({ message, variant = 'success', onDone }: ToastProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDone, 200);
    }, 3000);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div className={`toast toast--${variant}${visible ? ' toast--visible' : ''}`}>{message}</div>
  );
}
