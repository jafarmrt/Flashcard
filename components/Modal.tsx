import React from 'react';

interface ModalProps {
  show: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

const Modal: React.FC<ModalProps> = ({ show, onClose, title, children }) => {
  if (!show) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg p-6 m-4 animate-toast-in" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h3 id="modal-title" className="text-xl font-bold text-slate-800 dark:text-slate-100">{title}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 transition-colors" aria-label="Close modal">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div className="text-slate-600 dark:text-slate-300 whitespace-pre-wrap">
          {children}
        </div>
      </div>
    </div>
  );
};

export default Modal;
