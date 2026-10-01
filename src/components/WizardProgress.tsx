import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '../lib/utils';

interface Step {
  number: number;
  label: string;
}

interface WizardProgressProps {
  steps: Step[];
  currentStep: number;
}

export default function WizardProgress({ steps, currentStep }: WizardProgressProps) {
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {steps.map((step, idx) => {
        const isCompleted = currentStep > step.number;
        const isActive = currentStep === step.number;
        return (
          <React.Fragment key={step.number}>
            <div className="flex items-center gap-2">
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all shrink-0",
                isCompleted ? "text-white border-transparent" :
                isActive ? "text-white border-transparent" :
                "bg-white dark:bg-neutral-800 border-stone-300 dark:border-neutral-600 text-stone-400 dark:text-neutral-500"
              )}
              style={isCompleted ? { background: 'var(--brand-primary)', borderColor: 'var(--brand-primary)' } : isActive ? { background: 'var(--brand-secondary)', borderColor: 'var(--brand-secondary)' } : {}}>
                {isCompleted ? <Check className="w-4 h-4" /> : step.number}
              </div>
              <span className={cn(
                "text-sm font-bold hidden sm:inline",
                isActive ? "" :
                isCompleted ? "" :
                "text-stone-400 dark:text-neutral-500"
              )}
              style={isActive ? { color: 'var(--brand-secondary)' } : isCompleted ? { color: 'var(--brand-primary)' } : {}}>
                {step.label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div className={cn(
                "w-12 sm:w-20 h-0.5 mx-2 transition-colors",
                isCompleted ? "" : "bg-stone-200 dark:bg-neutral-700"
              )}
              style={isCompleted ? { background: 'var(--brand-primary)' } : {}} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
