import React, { useRef } from 'react';
import { Settings } from '../types';

interface SettingsViewProps {
    settings: Settings;
    onUpdateSettings: (newSettings: Partial<Settings>) => void;
    onExportCSV: () => void;
    onImportCSV: (csvText: string) => void;
    onResetApp: () => void;
    onNavigateToChangelog: () => void;
    syncView: React.ReactNode;
}

const SettingsView: React.FC<SettingsViewProps> = ({
    settings,
    onUpdateSettings,
    onExportCSV,
    onImportCSV,
    onResetApp,
    onNavigateToChangelog,
    syncView
}) => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const text = e.target?.result as string;
                onImportCSV(text);
            };
            reader.readAsText(file);
        }
        // Reset file input to allow re-uploading the same file
        event.target.value = '';
    };

    return (
        <div className="max-w-3xl mx-auto space-y-8">
            <h2 className="text-3xl font-bold text-slate-800 dark:text-slate-100">Settings</h2>

            {/* Sync View */}
            {syncView}
            
            {/* General Settings */}
            <div className="bg-slate-100 dark:bg-slate-900/50 p-6 rounded-lg border border-slate-200 dark:border-slate-700">
                <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-4">General</h3>
                <div className="space-y-4">
                    {/* Theme */}
                    <div>
                        <label htmlFor="theme-select" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Theme</label>
                        <select
                            id="theme-select"
                            value={settings.theme}
                            onChange={(e) => onUpdateSettings({ theme: e.target.value as Settings['theme'] })}
                            className="mt-1 block w-full max-w-xs pl-3 pr-10 py-2 text-base border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
                        >
                            <option value="light">Light</option>
                            <option value="dark">Dark</option>
                            <option value="system">System</option>
                        </select>
                    </div>
                     {/* Default Dictionary API */}
                    <div>
                        <label htmlFor="api-select" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Default Dictionary Source</label>
                        <select
                            id="api-select"
                            value={settings.defaultApiSource}
                            onChange={(e) => onUpdateSettings({ defaultApiSource: e.target.value as Settings['defaultApiSource'] })}
                            className="mt-1 block w-full max-w-xs pl-3 pr-10 py-2 text-base border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
                        >
                            <option value="free">Free Dictionary (Faster, less detail)</option>
                            <option value="mw">Merriam-Webster (Slower, more detail)</option>
                        </select>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Select the primary source for fetching word details.</p>
                    </div>
                </div>
            </div>

            {/* Data Management */}
            <div className="bg-slate-100 dark:bg-slate-900/50 p-6 rounded-lg border border-slate-200 dark:border-slate-700">
                <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-4">Data Management</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <button onClick={onExportCSV} className="w-full px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors">Export All Cards (CSV)</button>
                    <button onClick={handleImportClick} className="w-full px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors">Import Cards (CSV)</button>
                    <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".csv" className="hidden" />
                </div>
            </div>
            
            {/* About & Danger Zone */}
            <div className="space-y-8">
                 <div className="bg-slate-100 dark:bg-slate-900/50 p-6 rounded-lg border border-slate-200 dark:border-slate-700">
                     <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-4">About</h3>
                     <button onClick={onNavigateToChangelog} className="text-indigo-600 dark:text-indigo-400 hover:underline">View Version History & Changelog</button>
                </div>
                <div className="bg-red-50 dark:bg-red-900/20 p-6 rounded-lg border border-red-200 dark:border-red-700/50">
                    <h3 className="text-xl font-bold text-red-800 dark:text-red-200 mb-2">Danger Zone</h3>
                    <p className="text-sm text-red-700 dark:text-red-300 mb-4">This action is irreversible. All your local flashcards and decks will be permanently deleted.</p>
                    <button onClick={onResetApp} className="w-full sm:w-auto px-4 py-3 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors">Reset Application</button>
                </div>
            </div>
        </div>
    );
};

export default SettingsView;
