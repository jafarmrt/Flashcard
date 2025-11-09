import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Chat } from '@google/genai';
import { Flashcard } from '../types';

interface Message {
  role: 'user' | 'model';
  text: string;
}

interface ConversationViewProps {
  cards: Flashcard[];
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const ConversationView: React.FC<ConversationViewProps> = ({ cards }) => {
  const [chat, setChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [userInput, setUserInput] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [practiceWords, setPracticeWords] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const startConversation = async () => {
      setIsLoading(true);
      
      const words = [...cards]
        .sort(() => 0.5 - Math.random()) // Shuffle
        .slice(0, 10) // Take up to 10
        .map(c => c.front);
      setPracticeWords(words);
      
      const systemInstruction = `You are a friendly and encouraging English tutor. Your student is a native Persian speaker.
      Your goal is to have a natural, simple conversation in English.
      During the conversation, you MUST try to naturally use the following vocabulary words: ${words.join(', ')}.
      Keep your responses relatively short and easy to understand. Start the conversation with a friendly greeting.`;

      const newChat = ai.chats.create({
        model: 'gemini-2.5-flash',
        config: { systemInstruction },
      });
      setChat(newChat);

      // Start with the model's greeting
      const initialResponse = await newChat.sendMessageStream({ message: "Hello!" });
      let initialText = '';
      for await (const chunk of initialResponse) {
          initialText += chunk.text;
      }
      setMessages([{ role: 'model', text: initialText }]);
      setIsLoading(false);
    };
    startConversation();
  }, [cards]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userInput.trim() || !chat || isLoading) return;

    const userMessage: Message = { role: 'user', text: userInput };
    setMessages(prev => [...prev, userMessage]);
    setUserInput('');
    setIsLoading(true);

    const modelResponse: Message = { role: 'model', text: '' };
    setMessages(prev => [...prev, modelResponse]);

    try {
      const responseStream = await chat.sendMessageStream({ message: userInput });
      let currentText = '';
      for await (const chunk of responseStream) {
        currentText += chunk.text;
        setMessages(prev => {
          const newMessages = [...prev];
          newMessages[newMessages.length - 1].text = currentText;
          return newMessages;
        });
      }
    } catch (error) {
      console.error("Error sending message:", error);
      setMessages(prev => {
        const newMessages = [...prev];
        newMessages[newMessages.length - 1].text = "Sorry, something went wrong. Please try again.";
        return newMessages;
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  return (
    <div className="max-w-3xl mx-auto flex flex-col h-[calc(100vh-10rem)] bg-white dark:bg-slate-800 rounded-lg shadow-md">
      <div className="p-4 border-b border-slate-200 dark:border-slate-700">
        <h2 className="text-xl font-bold">Conversation Practice</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
            Practice using these words: <span className="font-medium text-indigo-500">{practiceWords.join(', ')}</span>
        </p>
      </div>
      <div className="flex-1 p-4 overflow-y-auto space-y-4">
        {messages.map((msg, index) => (
          <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-lg px-4 py-2 rounded-xl ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100'}`}>
              <p className="whitespace-pre-wrap">{msg.text}</p>
            </div>
          </div>
        ))}
         {isLoading && messages.length > 0 && messages[messages.length-1].role === 'user' && (
             <div className="flex justify-start">
                 <div className="max-w-lg px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-700">
                     <span className="animate-pulse">...</span>
                 </div>
             </div>
         )}
        <div ref={messagesEndRef} />
      </div>
      <div className="p-4 border-t border-slate-200 dark:border-slate-700">
        <form onSubmit={handleSendMessage} className="flex items-center gap-4">
          <input
            type="text"
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            placeholder="Type your message..."
            disabled={isLoading}
            className="flex-1 block w-full px-3 py-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading || !userInput.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
};
