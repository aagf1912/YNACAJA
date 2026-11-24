import React from 'react';
import { PlusCircle, List, BarChart3 } from 'lucide-react';

export type TabKey = 'registrar' | 'movimientos' | 'balance';

interface Props {
  activeTab: TabKey;
  onSelectTab: (tab: TabKey) => void;
}

export const Navigation: React.FC<Props> = ({ activeTab, onSelectTab }) => {
  const tabs = [
    {
      key: 'registrar' as TabKey,
      label: 'Registrar',
      icon: PlusCircle,
    },
    {
      key: 'movimientos' as TabKey,
      label: 'Movimientos',
      icon: List,
    },
    {
      key: 'balance' as TabKey,
      label: 'Balance',
      icon: BarChart3,
    },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-[#E4E4E7] shadow-sm safe-bottom">
      <div className="max-w-4xl mx-auto flex items-center justify-around h-16 px-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;

          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => onSelectTab(tab.key)}
              className={`flex-1 flex flex-col items-center justify-center min-h-[48px] py-1 rounded transition-colors ${
                isActive
                  ? 'text-[#2C474E] font-bold'
                  : 'text-[#52525B] hover:text-[#18181B] font-medium'
              }`}
            >
              <div
                className={`relative flex items-center justify-center p-1 rounded-md transition-colors ${
                  isActive ? 'bg-[#ECFDF5] text-[#2C474E]' : ''
                }`}
              >
                <Icon size={20} strokeWidth={isActive ? 2.3 : 1.8} />
              </div>
              <span className="text-[11px] mt-0.5 tracking-tight">
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
