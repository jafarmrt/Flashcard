
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
    currentUser: { username: string } | null;
    onLogout: () => void;
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
    currentUser,
    onLogout
}) => {
    const importFileRef = useRef<HTMLInputElement>(null);
    const APP_VERSION = '5.3.0';

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

            {/* Account Settings */}
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm overflow-hidden">
                <h3 className="text-lg font-bold p-4 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">Account</h3>
                <SettingRow title="Logged In As" description="This is your current active user account.">
                    <div className="flex items-center gap-2">
                        <span className="font-semibold text-indigo-600 dark:text-indigo-400">{currentUser?.username}</span>
                        <button onClick={onLogout} className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors">
                            Logout
                        </button>
                    </div>
                </SettingRow>
            </div>


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
                                className={`px-3 py-1 rounded-md transition-colors ${settings.theme === theme.toLowerCase() ? 'bg-white dark:bg-slate-600 shadow font-semibold text-indigo-700 dark:text-white' : 'hover:bg-slate-200/70 dark:hover:bg-slate-600/70'}`}>
                                {theme}
                            </button>
                        ))}
                    </div>
                </SettingRow>
                 <SettingRow title="Default Dictionary" description="Select the default source for fetching new card details.">
                     <div className="flex items-center gap-2 p-1 bg-slate-200 dark:bg-slate-700 rounded-lg text-sm">
                        {(['free', 'mw'] as const).map(source => (
                            <button 
                                key={source} 
                                onClick={() => onUpdateSettings({ defaultApiSource: source })} 
                                className={`px-3 py-1 rounded-md transition-colors ${settings.defaultApiSource === source ? 'bg-white dark:bg-slate-600 shadow font-semibold text-indigo-700 dark:text-white' : 'hover:bg-slate-200/70 dark:hover:bg-slate-600/70'}`}>
                                {source === 'free' ? 'Free Dictionary' : 'Merriam-Webster'}
                            </button>
                        ))}
                    </div>
                </SettingRow>
                <SettingRow title="Achievements" description="View the medals and milestones you've unlocked.">
                     <button onClick={onNavigateToAchievements} className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors">
                        View Achievements
                    </button>
                </SettingRow>
            </div>

            {/* AI Model & API Configuration */}
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm overflow-hidden">
                <h3 className="text-lg font-bold p-4 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
                    <span className="text-indigo-500">✨</span>
                    <span>AI Provider & Model Settings</span>
                </h3>
                <SettingRow title="AI Provider / Ecosystem" description="Choose Google Gemini or open-source / OpenAI-compatible services (Groq, OpenRouter, Ollama, DeepSeek).">
                    <select
                        value={settings.aiProvider === 'openai-compatible' ? (settings.aiBaseUrl?.includes('groq') ? 'groq' : settings.aiBaseUrl?.includes('openrouter') ? 'openrouter' : settings.aiBaseUrl?.includes('deepseek') ? 'deepseek' : settings.aiBaseUrl?.includes('localhost') ? 'ollama' : 'custom') : 'gemini'}
                        onChange={e => {
                            const val = e.target.value;
                            if (val === 'gemini') {
                                onUpdateSettings({ aiProvider: 'gemini', aiBaseUrl: undefined, aiModel: 'gemini-2.5-flash' });
                            } else if (val === 'groq') {
                                onUpdateSettings({ aiProvider: 'openai-compatible', aiBaseUrl: 'https://api.groq.com/openai/v1', aiModel: 'llama-3.3-70b-versatile' });
                            } else if (val === 'openrouter') {
                                onUpdateSettings({ aiProvider: 'openai-compatible', aiBaseUrl: 'https://openrouter.ai/api/v1', aiModel: 'deepseek/deepseek-chat' });
                            } else if (val === 'deepseek') {
                                onUpdateSettings({ aiProvider: 'openai-compatible', aiBaseUrl: 'https://api.deepseek.com/v1', aiModel: 'deepseek-chat' });
                            } else if (val === 'ollama') {
                                onUpdateSettings({ aiProvider: 'openai-compatible', aiBaseUrl: 'http://localhost:11434/v1', aiModel: 'llama3.3' });
                            } else {
                                onUpdateSettings({ aiProvider: 'openai-compatible' });
                            }
                        }}
                        className="px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 font-medium"
                    >
                        <option value="gemini">Google Gemini (Built-in / Official)</option>
                        <option value="groq">Groq (Ultra-Fast Open Source - Llama 3 / Mixtral)</option>
                        <option value="openrouter">OpenRouter (All Open-Source Models)</option>
                        <option value="deepseek">DeepSeek API</option>
                        <option value="ollama">Ollama / Local Server (localhost:11434)</option>
                        <option value="custom">Custom OpenAI-Compatible Endpoint</option>
                    </select>
                </SettingRow>

                {settings.aiProvider === 'openai-compatible' && (
                    <SettingRow title="API Base URL" description="The base endpoint URL for your OpenAI-compatible service.">
                        <input
                            type="text"
                            placeholder="https://api.groq.com/openai/v1"
                            value={settings.aiBaseUrl || ''}
                            onChange={e => onUpdateSettings({ aiBaseUrl: e.target.value.trim() || undefined })}
                            className="w-64 px-3 py-1.5 text-xs font-mono rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200"
                        />
                    </SettingRow>
                )}

                <SettingRow title="Model Identifier" description="Model name (e.g. gemini-2.5-flash, llama-3.3-70b-versatile, deepseek-chat).">
                    <input
                        type="text"
                        placeholder="Model name"
                        value={settings.aiModel || (settings.aiProvider === 'openai-compatible' ? 'llama-3.3-70b-versatile' : 'gemini-2.5-flash')}
                        onChange={e => onUpdateSettings({ aiModel: e.target.value.trim() || undefined })}
                        className="w-64 px-3 py-1.5 text-xs font-mono rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200"
                    />
                </SettingRow>

                <SettingRow title="API Key" description="API key for your provider. Leave empty to use system key (Gemini) or for local Ollama.">
                    <div className="flex items-center gap-2">
                        <input
                            type="password"
                            placeholder="API Key (optional/required by provider)"
                            value={settings.customApiKey || ''}
                            onChange={e => onUpdateSettings({ customApiKey: e.target.value.trim() || undefined })}
                            className="w-56 px-3 py-1.5 text-xs font-mono rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200"
                        />
                        {settings.customApiKey && (
                            <button
                                onClick={() => onUpdateSettings({ customApiKey: undefined })}
                                className="text-xs text-red-500 hover:underline"
                            >
                                Clear
                            </button>
                        )}
                    </div>
                </SettingRow>

                <SettingRow title="Default English Level" description="Your target proficiency level for automatic AI vocabulary extraction.">
                    <select
                        value={settings.userLevel || 'B2'}
                        onChange={e => onUpdateSettings({ userLevel: e.target.value as any })}
                        className="px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 font-medium"
                    >
                        <option value="A1">A1 - Beginner</option>
                        <option value="A2">A2 - Elementary</option>
                        <option value="B1">B1 - Intermediate</option>
                        <option value="B2">B2 - Upper Intermediate</option>
                        <option value="C1">C1 - Advanced</option>
                        <option value="C2">C2 - Proficient</option>
                        <option value="IELTS">IELTS / Academic</option>
                        <option value="TOEFL">TOEFL Vocabulary</option>
                    </select>
                </SettingRow>
            </div>

            {/* Bulk Add Settings */}
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm overflow-hidden">
                <h3 className="text-lg font-bold p-4 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">Bulk Add Settings</h3>
                <SettingRow title="Concurrency" description="Number of words to process at the same time (1-3). Higher is faster but may hit API limits.">
                    <div className="flex items-center gap-4">
                        <input type="range" min="1" max="3" step="1" value={settings.bulkAddConcurrency || 3} onChange={e => onUpdateSettings({ bulkAddConcurrency: parseInt(e.target.value, 10) })} className="w-32"/>
                        <span className="font-bold w-4 text-center">{settings.bulkAddConcurrency || 3}</span>
                    </div>
                </SettingRow>
                <SettingRow title="AI Timeout" description="How long to wait for the AI to respond for each word (in seconds).">
                     <div className="flex items-center gap-4">
                        <input type="range" min="5" max="60" step="5" value={settings.bulkAddAiTimeout || 15} onChange={e => onUpdateSettings({ bulkAddAiTimeout: parseInt(e.target.value, 10) })} className="w-32"/>
                        <span className="font-bold w-8 text-center">{settings.bulkAddAiTimeout || 15}s</span>
                    </div>
                </SettingRow>
                <SettingRow title="Dictionary Timeout" description="How long to wait for the primary dictionary before trying the backup.">
                     <div className="flex items-center gap-4">
                        <input type="range" min="3" max="20" step="1" value={settings.bulkAddDictTimeout || 5} onChange={e => onUpdateSettings({ bulkAddDictTimeout: parseInt(e.target.value, 10) })} className="w-32"/>
                        <span className="font-bold w-8 text-center">{settings.bulkAddDictTimeout || 5}s</span>
                    </div>
                </SettingRow>
            </div>

            {/* Data Management */}
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm overflow-hidden">
                 <h3 className="text-lg font-bold p-4 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">Data Management</h3>
                 <SettingRow title="Import / Export" description="Save your data to a CSV file or load data from one.">
                    <div className="flex gap-2">
                        <input type="file" ref={importFileRef} onChange={handleFileImport} accept=".csv" className="hidden" />
                        <button onClick={handleImportClick} className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors">
                            Import CSV
                        </button>
                        <button onClick={onExportCSV} className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors">
                            Export CSV
                        </button>
                    </div>
                </SettingRow>
            </div>

            {/* Danger Zone */}
            <div className="bg-red-50 dark:bg-red-900/20 rounded-lg shadow-sm overflow-hidden border border-red-200 dark:border-red-900/50">
                 <h3 className="text-lg font-bold p-4 text-red-800 dark:text-red-200 bg-red-100 dark:bg-red-900/30 border-b border-red-200 dark:border-red-900/50">Danger Zone</h3>
                 <SettingRow title="Reset Application" description="This will permanently delete all your local data. This action cannot be undone.">
                    <button onClick={onResetApp} className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md shadow-sm">
                        Reset App
                    </button>
                 </SettingRow>
            </div>
        </div>
    );
};

export default SettingsView;
