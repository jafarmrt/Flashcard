
import React from 'react';

interface ToastProps {
  message: string;
}

const Toast: React.FC<ToastProps> = ({ message }) => {
  return (
    <div className="fixed bottom-5 right-5 bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-800 px-6 py-3 rounded-lg shadow-lg animate-toast-in">
      <p className="font-medium">{message}</p>
    </div>
  );
};

export default Toast;
