import React, { useState, useEffect, useMemo } from 'react';
import { UserProfile, UserAchievement, Achievement } from '../types';
import { ALL_ACHIEVEMENTS } from '../services/achievements';
import { StreakCounter, LevelProgressBar } from './GamificationWidgets';

interface ProfileViewProps {
  userProfile: UserProfile | null;
  streak: number;
  earnedAchievements: UserAchievement[];
  onSave: (profileData: Partial<UserProfile>) => void;
  onBack: () => void;
  onNavigateToAchievements: () => void;
}

const EditIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>;

export const ProfileView: React.FC<ProfileViewProps> = ({ userProfile, streak, earnedAchievements, onSave, onBack, onNavigateToAchievements }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<Partial<UserProfile>>({
    firstName: '',
    lastName: '',
    bio: ''
  });

  useEffect(() => {
    if (userProfile && !isEditing) {
      setFormData({
        firstName: userProfile.firstName || '',
        lastName: userProfile.lastName || '',
        bio: userProfile.bio || ''
      });
    }
  }, [userProfile, isEditing]);
  
  const handleSave = () => {
      onSave(formData);
      setIsEditing(false);
  }

  const handleCancel = () => {
    if (userProfile) {
        setFormData({
            firstName: userProfile.firstName || '',
            lastName: userProfile.lastName || '',
            bio: userProfile.bio || '',
        });
    }
    setIsEditing(false);
  };

  const achievementsById = useMemo(() => new Map(ALL_ACHIEVEMENTS.map(a => [a.id, a])), []);

  const recentAchievements = useMemo(() => {
      return [...earnedAchievements]
          .sort((a, b) => new Date(b.dateEarned).getTime() - new Date(a.dateEarned).getTime())
          .slice(0, 5)
          .map(ea => achievementsById.get(ea.achievementId))
          .filter((a): a is Achievement => a !== undefined);
  }, [earnedAchievements, achievementsById]);

  if (!userProfile) {
    return <div className="text-center p-10">Loading profile...</div>;
  }
  
  const fullName = [formData.firstName, formData.lastName].filter(Boolean).join(' ') || "Anonymous User";

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-center gap-6">
        <div className="w-24 h-24 bg-indigo-100 dark:bg-indigo-900 rounded-full flex items-center justify-center text-4xl font-bold text-indigo-500">
          {fullName.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 text-center sm:text-left">
           <h2 className="text-3xl font-bold text-slate-800 dark:text-slate-100">{fullName}</h2>
           <p className="text-slate-500 dark:text-slate-400">Level {userProfile.level} Learner</p>
        </div>
        {!isEditing && (
            <button onClick={() => setIsEditing(true)} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors">
                <EditIcon /> Edit Profile
            </button>
        )}
      </div>

      {/* Profile Form or Display */}
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-6">
        {isEditing ? (
            <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="firstName" className="block text-sm font-medium text-slate-700 dark:text-slate-300">First Name</label>
                        <input type="text" id="firstName" value={formData.firstName} onChange={e => setFormData({...formData, firstName: e.target.value})} className="mt-1 block w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm" />
                    </div>
                     <div>
                        <label htmlFor="lastName" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Last Name</label>
                        <input type="text" id="lastName" value={formData.lastName} onChange={e => setFormData({...formData, lastName: e.target.value})} className="mt-1 block w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm" />
                    </div>
                </div>
                <div>
                    <label htmlFor="bio" className="block text-sm font-medium text-slate-700 dark:text-slate-300">Bio</label>
                    <textarea id="bio" rows={3} value={formData.bio} onChange={e => setFormData({...formData, bio: e.target.value})} className="mt-1 block w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm" placeholder="Tell us a bit about your language learning goals..."></textarea>
                </div>
                <div className="flex justify-end gap-2">
                    <button onClick={handleCancel} className="px-4 py-2 text-sm font-medium rounded-md">Cancel</button>
                    <button onClick={handleSave} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md">Save Changes</button>
                </div>
            </div>
        ) : (
            <p className="text-slate-600 dark:text-slate-300 italic">
                {userProfile.bio || "No bio yet. Click 'Edit Profile' to add one."}
            </p>
        )}
      </div>
      
      {/* Gamification Stats */}
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm p-6 flex flex-col md:flex-row items-center gap-6">
          <StreakCounter streak={streak} />
          <LevelProgressBar userProfile={userProfile} />
      </div>

      {/* Recent Achievements */}
      <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium text-slate-500 dark:text-slate-400">Recent Achievements</h3>
          <button onClick={onNavigateToAchievements} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">View All</button>
        </div>
        {recentAchievements.length > 0 ? (
            <div className="flex flex-wrap gap-4">
                {recentAchievements.map(ach => (
                    <div key={ach.id} className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-700/50 rounded-md text-sm" title={`${ach.name}: ${ach.description}`}>
                        <span className="text-2xl">{ach.icon}</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-200">{ach.name}</span>
                    </div>
                ))}
            </div>
        ) : (
            <p className="text-center text-slate-500 dark:text-slate-400 py-4">No achievements unlocked yet. Keep studying!</p>
        )}
      </div>

       <div className="text-center mt-4">
            <button onClick={onBack} className="px-6 py-2 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100 font-semibold shadow-sm hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors">
              Back to Settings
            </button>
       </div>
    </div>
  );
};