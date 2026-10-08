
import React from 'react';

interface ToastProps {
  message: string;
}

const Toast: React.FC<ToastProps> = ({ message }) => {
  return (
    // Responsive positioning: Centered and above the bottom nav on mobile, bottom-right on desktop.
    // Added a high z-index to ensure it's on top of all other elements.
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 md:bottom-5 md:left-5 md:right-auto md:translate-x-0 z-50 bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-800 px-6 py-3 rounded-lg shadow-lg animate-toast-in">
      <p dir="auto" className="font-medium text-center md:text-start">{message}</p>
    </div>
  );
};

export default Toast;
