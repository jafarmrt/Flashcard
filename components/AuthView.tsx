import React, { useState } from 'react';
import { Icon } from './common/ui';

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

  return (
    <div
      dir="rtl"
      className="min-h-screen font-fa flex items-center justify-center bg-[#F7F5F0] dark:bg-[#0D1311] text-ink dark:text-slate-100 px-4 py-10"
    >
      <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-stone-200/80 dark:border-slate-800 p-7 sm:p-9 rounded-3xl flex flex-col gap-6">
        <header className="flex flex-col items-center text-center gap-2">
          <div className="w-12 h-12 rounded-2xl bg-brand-500 text-white flex items-center justify-center mb-1">
            <Icon.Book size={24} />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-ink dark:text-white">
            واژه‌خوان
          </h1>
          <p className="text-sm text-ink-muted dark:text-slate-400 leading-relaxed max-w-xs">
            {isLoginView
              ? 'ورود به کتابخانهٔ شخصی و واژه‌های ذخیره‌شده'
              : 'ساخت حساب تازه برای خواندن کتاب و یادگیری ماندگار واژه‌ها'}
          </p>
        </header>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="username" className="text-sm font-bold text-ink dark:text-slate-200">
              نام کاربری
            </label>
            <input
              id="username"
              name="username"
              type="text"
              dir="ltr"
              autoComplete="username"
              required
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="min-h-[48px] rounded-xl block w-full px-4 border border-stone-300 dark:border-slate-700 bg-[#FBF9F5] dark:bg-slate-800 placeholder-slate-400 text-ink dark:text-slate-100 font-en text-left focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
              placeholder="username"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-bold text-ink dark:text-slate-200">
              گذرواژه
            </label>
            <input
              id="password"
              name="password"
              type="password"
              dir="ltr"
              autoComplete={isLoginView ? 'current-password' : 'new-password'}
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="min-h-[48px] rounded-xl block w-full px-4 border border-stone-300 dark:border-slate-700 bg-[#FBF9F5] dark:bg-slate-800 placeholder-slate-400 text-ink dark:text-slate-100 font-en text-left focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="mt-1 w-full min-h-[50px] flex items-center justify-center px-5 text-base font-extrabold rounded-xl text-white bg-brand-500 hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500 disabled:opacity-60 disabled:cursor-wait transition-colors"
          >
            {isLoading
              ? 'در حال بررسی…'
              : isLoginView
                ? 'ورود به حساب'
                : 'ساخت حساب'}
          </button>
        </form>

        <div className="text-center pt-2 border-t border-stone-200/70 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setIsLoginView(!isLoginView)}
            className="min-h-[44px] px-3 text-sm font-bold text-brand-600 hover:text-brand-700 dark:text-brand-300 dark:hover:text-brand-200"
          >
            {isLoginView
              ? 'حساب نداری؟ ساخت حساب تازه'
              : 'از قبل حساب داری؟ ورود به حساب'}
          </button>
        </div>
      </div>
    </div>
  );
};