'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type DatePickerProps = {
  id?: string;
  value?: Date;
  onChange: (next: Date | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Formats a local Date as YYYY-MM-DD (date-only).
 * This intentionally avoids timezone conversions; it uses local calendar fields.
 */
export function formatDateOnlyYYYYMMDD(date: Date): string {
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  return `${y}-${m}-${d}`;
}

function startOfMonth(year: number, monthIndex: number): Date {
  return new Date(year, monthIndex, 1);
}

function daysInMonth(year: number, monthIndex: number): number {
  // MonthIndex + 1 with day 0 gives last day of target month
  return new Date(year, monthIndex + 1, 0).getDate();
}

function sameDay(a: Date | undefined, b: Date): boolean {
  if (!a) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function monthLabel(date: Date): string {
  // Keep it dependency-free; use locale formatting.
  return date.toLocaleDateString('es-SV', { month: 'long', year: 'numeric' });
}

function CalendarIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4 text-muted-foreground"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 2v4M16 2v4" />
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M3 10h18" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

export function DatePicker({
  id,
  value,
  onChange,
  placeholder = 'Seleccionar fecha',
  disabled,
}: DatePickerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  // Drive the visible month from selected value (or today).
  const initialMonth = useMemo(() => {
    const base = value ?? new Date();
    return startOfMonth(base.getFullYear(), base.getMonth());
  }, [value]);

  const [visibleMonth, setVisibleMonth] = useState<Date>(initialMonth);

  useEffect(() => {
    // If external value changes, snap calendar to that month.
    setVisibleMonth(initialMonth);
  }, [initialMonth]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    const onMouseDown = (e: MouseEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (e.target instanceof Node && !root.contains(e.target)) {
        setOpen(false);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [open]);

  const year = visibleMonth.getFullYear();
  const monthIndex = visibleMonth.getMonth();
  const first = startOfMonth(year, monthIndex);
  const firstWeekday = first.getDay(); // 0 (Sun) ... 6 (Sat)
  const totalDays = daysInMonth(year, monthIndex);

  // Monday-first grid: map JS Sunday=0 to index 6 at end.
  const mondayFirstOffset = (firstWeekday + 6) % 7;

  const cells: Array<{ date: Date; inMonth: boolean }> = [];

  // Fill leading days (from previous month)
  if (mondayFirstOffset > 0) {
    const prevMonth = new Date(year, monthIndex - 1, 1);
    const prevYear = prevMonth.getFullYear();
    const prevMonthIndex = prevMonth.getMonth();
    const prevDays = daysInMonth(prevYear, prevMonthIndex);
    for (let i = mondayFirstOffset - 1; i >= 0; i--) {
      const day = prevDays - i;
      cells.push({ date: new Date(prevYear, prevMonthIndex, day), inMonth: false });
    }
  }

  // Current month days
  for (let day = 1; day <= totalDays; day++) {
    cells.push({ date: new Date(year, monthIndex, day), inMonth: true });
  }

  // Trailing days to complete 6 rows (42 cells)
  while (cells.length < 42) {
    const last = cells[cells.length - 1]!.date;
    const next = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
    cells.push({ date: next, inMonth: false });
  }

  const displayValue = value
    ? value.toLocaleDateString('es-SV', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={displayValue ? 'text-foreground' : 'text-muted-foreground'}>
          {displayValue || placeholder}
        </span>
        <CalendarIcon />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Seleccionar fecha"
          className="dark:bg-popover dark:text-popover-foreground absolute left-0 top-12 z-[9999] w-[320px] rounded-md border border-border bg-white p-3 text-foreground shadow-2xl"
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
              onClick={() => setVisibleMonth(new Date(year, monthIndex - 1, 1))}
            >
              <ChevronLeftIcon />
              <span className="sr-only">Mes anterior</span>
            </button>
            <div className="text-sm font-medium capitalize">{monthLabel(visibleMonth)}</div>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
              onClick={() => setVisibleMonth(new Date(year, monthIndex + 1, 1))}
            >
              <ChevronRightIcon />
              <span className="sr-only">Mes siguiente</span>
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
            <div>L</div>
            <div>M</div>
            <div>M</div>
            <div>J</div>
            <div>V</div>
            <div>S</div>
            <div>D</div>
          </div>

          <div className="mt-1 grid grid-cols-7 gap-1">
            {cells.map(({ date, inMonth }) => {
              const isSelected = sameDay(value, date);
              const isToday = sameDay(new Date(), date);

              return (
                <button
                  key={formatDateOnlyYYYYMMDD(date)}
                  type="button"
                  onClick={() => {
                    onChange(date);
                    setOpen(false);
                  }}
                  className={[
                    'h-9 rounded-md text-sm transition-colors',
                    'hover:bg-accent hover:text-accent-foreground',
                    !inMonth ? 'text-muted-foreground/60' : 'text-foreground',
                    isToday && !isSelected ? 'border border-input' : '',
                    isSelected ? 'bg-primary text-primary-foreground hover:bg-primary/90' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => {
                onChange(undefined);
                setOpen(false);
              }}
            >
              Limpiar
            </button>
            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => {
                onChange(new Date());
                setOpen(false);
              }}
            >
              Hoy
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
