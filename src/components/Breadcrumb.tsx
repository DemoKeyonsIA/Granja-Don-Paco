import React from 'react';
import { ChevronRight, Home } from 'lucide-react';
import { cn } from '../lib/utils';

interface BreadcrumbItem {
  label: string;
  onClick?: () => void;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
}

export default function Breadcrumb({ items, className }: BreadcrumbProps) {
  return (
    <nav className={cn("flex items-center text-xs font-medium text-stone-500 dark:text-stone-400 mb-4", className)}>
      <button onClick={items[0]?.onClick} className="flex items-center gap-1 hover:opacity-70 transition-opacity" style={{ color: 'var(--text-link)' }}>
        <Home className="w-3.5 h-3.5" />
        <span>Inicio</span>
      </button>
      {items.map((item, idx) => (
        <React.Fragment key={idx}>
          <ChevronRight className="w-3 h-3 mx-1.5 text-stone-300 dark:text-neutral-600" />
          {item.onClick ? (
            <button onClick={item.onClick} className="hover:opacity-70 transition-opacity" style={{ color: 'var(--text-link)' }}>{item.label}</button>
          ) : (
            <span className="text-stone-800 dark:text-white font-bold">{item.label}</span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}
