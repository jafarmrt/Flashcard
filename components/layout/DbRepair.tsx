import React, { useState } from 'react';
import { resetLocalDatabase } from '../../services/localDBService';

// Shown only when this browser's database failed to open: a way out that
// does not need the browser's developer tools.
export const DbRepair: React.FC = () => {
  const [busy, setBusy] = useState(false);
  const repair = async () => {
    if (!window.confirm('پایگاه دادهٔ این مرورگر پاک و از نو ساخته می‌شود و کارت‌ها از سرور دوباره می‌آیند. چیزهایی که هنوز با سرور همگام نشده‌اند از بین می‌روند. ادامه می‌دهید؟')) return;
    setBusy(true);
    try {
      await resetLocalDatabase();
    } catch (e) {
      setBusy(false);
      window.alert(`پاک کردن نشد: ${(e as Error)?.message || e}. همهٔ زبانه‌های دیگر این برنامه را ببندید و دوباره امتحان کنید.`);
    }
  };
  return (
    <button
      type="button"
      onClick={repair}
      disabled={busy}
      className="mx-auto mt-2 block rounded-lg border border-red-300 px-3 py-1 text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/30"
    >
      {busy ? 'در حال پاک کردن…' : 'تعمیر پایگاه دادهٔ مرورگر'}
    </button>
  );
};
