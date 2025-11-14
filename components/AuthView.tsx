import React, { useState } from 'react';

interface AuthViewProps {
  onLogin: (username: string, password: string) => void;
  onRegister: (username: string, password: string) => void;
  isLoading: boolean;
}

export const AuthView: React.FC<AuthViewProps> = ({ onLogin, onRegister, isLoading }) => {
  const [isLoginView, setIsLoginView] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    if (isLoginView) {
      onLogin(username, password);
    } else {
      onRegister(username, password);
    }
  };

  const title = isLoginView ? 'Welcome Back!' : 'Create Your Account';
  const subTitle = isLoginView ? 'Log in to access your flashcards.' : 'Sign up to start learning.';
  const buttonText = isLoginView ? 'Login' : 'Create Account';
  const switchLinkText = isLoginView ? "Don't have an account? Register" : 'Already have an account? Login';
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 px-4">
      <div className="max-w-md w-full bg-white dark:bg-slate-800 p-8 rounded-xl shadow-lg space-y-6">
        <div className="text-center">
            <div className="flex justify-center items-center gap-3 mb-4">
                 <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-indigo-500">
                    <rect width="32" height="32" rx="6" fill="currentColor"/>
                    <path d="M12 10C12 8.89543 12.8954 8 14 8H20C21.1046 8 22 8.89543 22 10V14C22 15.1046 21.1046 16 20 16H18" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M10 16C10 14.8954 10.8954 14 12 14H18C19.1046 14 20 14.8954 20 16V20C20 21.1046 19.1046 22 18 22H12C10.8954 22 10 21.1046 10 20V16Z" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                 </svg>
                 <h1 className="text-3xl font-bold text-slate-800 dark:text-white">Lingua Cards</h1>
            </div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{title}</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{subTitle}</p>
        </div>
        <form className="space-y-6" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="username" className="sr-only">Username</label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="appearance-none rounded-md relative block w-full px-3 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 placeholder-slate-500 dark:placeholder-slate-400 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
              placeholder="Username"
            />
          </div>
          <div>
            <label htmlFor="password" className="sr-only">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="appearance-none rounded-md relative block w-full px-3 py-3 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 placeholder-slate-500 dark:placeholder-slate-400 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
              placeholder="Password"
            />
          </div>

          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-indigo-400 disabled:cursor-wait"
            >
              {isLoading ? 'Processing...' : buttonText}
            </button>
          </div>
        </form>
        <div className="text-center">
            <button 
                onClick={() => setIsLoginView(!isLoginView)}
                className="text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
            >
                {switchLinkText}
            </button>
        </div>
      </div>
    </div>
  );
};