import Link from 'next/link';

interface FlowStep {
  label: string;
  href: string;
}

interface FlowStepperProps {
  steps: FlowStep[];
  currentStep: number;
}

export function FlowStepper({ steps, currentStep }: FlowStepperProps) {
  return (
    <nav aria-label="Progreso del flujo" className="mb-8">
      <ol className="flex items-center justify-center gap-0">
        {steps.map((step, index) => {
          const isCurrent = index === currentStep;
          const isPast = index < currentStep;
          const isFuture = index > currentStep;
          const isLast = index === steps.length - 1;

          const circleClasses = [
            'flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-medium',
            isCurrent || isPast
              ? 'bg-primary text-primary-foreground'
              : 'border-2 border-input text-muted-foreground',
          ].join(' ');

          const labelClasses = [
            'mt-2 text-xs',
            isCurrent ? 'font-semibold text-foreground' : 'text-muted-foreground',
          ].join(' ');

          const lineClasses = ['mx-2 h-0.5 w-8 sm:w-12', isPast ? 'bg-primary' : 'bg-input'].join(
            ' '
          );

          const stepContent = (
            <div className="flex flex-col items-center">
              <div className={circleClasses}>{index + 1}</div>
              <span className={labelClasses}>{step.label}</span>
            </div>
          );

          return (
            <li key={step.href} className="flex items-start">
              {isCurrent ? (
                <div className="flex flex-col items-center" aria-current="step">
                  {stepContent}
                </div>
              ) : (
                <Link
                  href={step.href}
                  className={`flex flex-col items-center ${isFuture ? '' : 'hover:opacity-80'}`}
                >
                  {stepContent}
                </Link>
              )}
              {!isLast && <div className={`${lineClasses} mt-4`} aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
