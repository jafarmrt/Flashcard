
import React from 'react';

interface ToastProps {
  message: string;
}

const Toast: React.FC<ToastProps> = ({ message }) => {
  return (
    // Centred above the bottom nav on phones, bottom-left on desktop. No
    // translate: the entrance animation sets its own transform.
    <div role="status" aria-live="polite" className="fixed inset-x-4 bottom-24 md:bottom-5 md:left-5 md:right-auto z-50 flex justify-center md:justify-start pointer-events-none">
      <div className="max-w-md bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-800 px-5 py-3 rounded-xl shadow-lg animate-toast-in pointer-events-auto">
        <p dir="auto" className="font-medium text-center md:text-start break-words">{message}</p>
      </div>
    </div>
  );
};

export default Toast;
