import React, { useRef } from 'react';
import { Settings } from '../types';

interface SettingsViewProps {
    settings: Settings;
    onUpdateSettings: (newSettings: Partial<Settings>) => void;
    onExportCSV: () => void;
    onImportCSV: (csvText: string) => void;
    onResetApp: () => void;
    onNavigateToChangelog: () => void;
    onNavigateToAchievements: () => void;
    onNavigateToProfile: () => void;
    syncView: React.ReactNode;
}

const SettingsView: React.FC<SettingsViewProps> = ({
    settings,
    onUpdateSettings,
    onExportCSV,
    onImportCSV,
    onResetApp,
    onNavigateToChangelog,
    onNavigateToAchievements,
    onNavigateToProfile,
    syncView
}) => {
    const importFileRef = useRef<HTMLInputElement>(null);
    const APP_VERSION = '3.5.2';

    const handleImportClick = () => {
        importFileRef.current?.click();
    };

    const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target?.result as string;
            onImportCSV(text);
        };
        reader.readAsText(file);
        event.target.value = ''; // Reset file input
    };
    
    const SettingRow: React.FC<{ title: string; description: string; children: React.ReactNode }> = ({ title, description, children }) => (
        <div className="flex flex-col sm:flex-row justify-between sm:items-center p-4 border-b border-slate-200 dark:border-slate-700 last:border-b-0">
            <div>
                <h4 className="font-semibold text-slate-800 dark:text-slate-100">{title}</h4>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{description}</p>
            </div>
            <div className="mt-4 sm:mt-0 flex-shrink-0">{children}</div>
        </div>
    );

    return (
        <div className="max-w-3xl mx-auto space-y-8">
            <h2 className="text-3xl font-bold text-slate-800 dark:text-slate-100">Settings</h2>

            {/* General Settings */}
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm overflow-hidden">
                <h3 className="text-lg font-bold p-4 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">General</h3>
                <SettingRow title="Profile" description="Manage your personal information and view your progress.">
                     <button onClick={onNavigateToProfile} className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors">
                        View Profile
                    </button>
                </SettingRow>
                <SettingRow title="App Version" description="Current version of the application.">
                    <div className="flex items-center gap-2">
                         <span className="px-3 py-1 bg-slate-200 dark:bg-slate-700 text-sm font-medium rounded-full">{APP_VERSION}</span>
                         <button onClick={onNavigateToChangelog} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">View Changelog</button>
                    </div>
                </SettingRow>
                <SettingRow title="Appearance" description="Choose a light or dark theme, or follow your system.">
                    <div className="flex items-center gap-2 p-1 bg-slate-200 dark:bg-slate-700 rounded-lg text-sm">
                        {(['Light', 'Dark', 'System'] as const).map(theme => (
                            <button 
                                key={theme} 
                                onClick={() => onUpdateSettings({ theme: theme.toLowerCase() as Settings['theme'] })} 
                                className={`px-3 py-1 rounded-md transition-colors ${settings.theme === theme.toLowerCase() ? 'bg-white dark:bg-slate-600 shadow' : 'hover:bg-white/50 dark:hover:bg-slate-600/50'}`}>
                                {theme}
                            </button>
                        ))}
                    </div>
                </SettingRow>
                 <SettingRow title="Default Dictionary" description="Select the default source for fetching new card details.">
                     <select 
                        value={settings.defaultApiSource} 
                        onChange={e => onUpdateSettings({ defaultApiSource: e.target.value as Settings['defaultApiSource'] })} 
                        className="block w-full max-w-xs pl-3 pr-10 py-2 text-base border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
                    >
                        <option value="free">Free Dictionary</option>
                        <option value="mw">Merriam-Webster</option>
                    </select>
                </SettingRow>
                <SettingRow title="Achievements" description="View the medals and milestones you've unlocked.">
                     <button onClick={onNavigateToAchievements} className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors">
                        View Achievements
                    </button>
                </SettingRow>
            </div>

            {/* Data Management */}
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm overflow-hidden">
                 <h3 className="text-lg font-bold p-4 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">Data Management</h3>
                 <SettingRow title="Import / Export" description="Save your data to a CSV file or load data from one.">
                    <div className="flex gap-2">
                        <input type="file" ref={importFileRef} onChange={handleFileImport} accept=".csv" className="hidden" />
                        <button onClick={handleImportClick} className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors">Import CSV</button>
                        <button onClick={onExportCSV} className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors">Export CSV</button>
                    </div>
                 </SettingRow>
                 <div className="p-4">
                    {syncView}
                 </div>
            </div>
            
            {/* Danger Zone */}
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm overflow-hidden border border-red-500/30 dark:border-red-500/50">
                <h3 className="text-lg font-bold p-4 bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200 border-b border-red-200 dark:border-red-500/50">Danger Zone</h3>
                <SettingRow title="Reset Application" description="Permanently delete all local decks and cards. This cannot be undone.">
                    <button onClick={onResetApp} className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors">Reset App</button>
                </SettingRow>
            </div>
        </div>
    );
};

export default SettingsView;