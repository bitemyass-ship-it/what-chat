export type EmployeeTabId = 'info' | 'chats';

interface EmployeeTabsProps {
  activeTab: EmployeeTabId;
  onTabChange: (tab: EmployeeTabId) => void;
}

const tabs: Array<{
  id: EmployeeTabId;
  label: string;
}> = [
  {
    id: 'chats',
    label: 'Chats'
  },
  {
    id: 'info',
    label: 'Info'
  }
];

export default function EmployeeTabs({
  activeTab,
  onTabChange
}: EmployeeTabsProps) {
  return (
    <div className="flex flex-wrap gap-3">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;

        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={`rounded-full px-5 py-2 text-sm font-medium transition-colors duration-200 ${
              isActive
                ? 'bg-slatewarm-950 text-white shadow-card'
                : 'border border-stone-300 bg-white text-slate-700 hover:border-slatewarm-950'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
