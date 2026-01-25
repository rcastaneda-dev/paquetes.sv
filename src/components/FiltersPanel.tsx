'use client';

import { useState, useEffect, useCallback } from 'react';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { Button } from './ui/Button';
import type { SchoolSearchResult } from '@/types/database';

interface FiltersPanelProps {
  onFilterChange: (filters: { school_codigo_ce: string | null; grado: string | null }) => void;
  onSearch: () => void;
}

interface GradesResponse {
  grades: string[];
  source?: string;
}

export function FiltersPanel({ onFilterChange, onSearch }: FiltersPanelProps) {
  const [schoolQuery, setSchoolQuery] = useState('');
  const [schoolResults, setSchoolResults] = useState<SchoolSearchResult[]>([]);
  const [selectedSchool, setSelectedSchool] = useState<SchoolSearchResult | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [grades, setGrades] = useState<string[]>([]);
  const [selectedGrade, setSelectedGrade] = useState<string>('');
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingGrades, setIsLoadingGrades] = useState(false);

  // Fetch available grades when a school is selected
  useEffect(() => {
    if (!selectedSchool) {
      setGrades([]);
      setSelectedGrade('');
      return;
    }

    setIsLoadingGrades(true);
    fetch(`/api/grades?school_codigo_ce=${encodeURIComponent(selectedSchool.codigo_ce)}`)
      .then(res => res.json())
      .then((data: GradesResponse) => {
        setGrades(data.grades || []);

        // Optional: warn in dev if not sourced from grado_ok
        if (process.env.NODE_ENV === 'development' && data.source && data.source !== 'grado_ok') {
          console.warn(`[FiltersPanel] Grades sourced from '${data.source}' instead of 'grado_ok'`);
        }
      })
      .catch(err => console.error('Error fetching grades:', err))
      .finally(() => setIsLoadingGrades(false));
  }, [selectedSchool]);

  // Debounced school search
  useEffect(() => {
    if (schoolQuery.length < 2) {
      setSchoolResults([]);
      return;
    }

    const timer = setTimeout(() => {
      fetch(`/api/schools/search?q=${encodeURIComponent(schoolQuery)}`)
        .then(res => res.json())
        .then(data => setSchoolResults(data.schools || []))
        .catch(err => console.error('Error searching schools:', err));
    }, 300);

    return () => clearTimeout(timer);
  }, [schoolQuery]);

  const handleSchoolSelect = useCallback(
    (school: SchoolSearchResult) => {
      setSelectedSchool(school);
      setSchoolQuery(school.codigo_ce);
      setShowDropdown(false);
      onFilterChange({
        school_codigo_ce: school.codigo_ce,
        grado: selectedGrade || null,
      });
    },
    [selectedGrade, onFilterChange]
  );

  const handleGradeChange = useCallback(
    (grade: string) => {
      setSelectedGrade(grade);
      onFilterChange({
        school_codigo_ce: selectedSchool?.codigo_ce || null,
        grado: grade || null,
      });
    },
    [selectedSchool, onFilterChange]
  );

  const handleClear = useCallback(() => {
    setSchoolQuery('');
    setSelectedSchool(null);
    setSelectedGrade('');
    setSchoolResults([]);
    onFilterChange({ school_codigo_ce: null, grado: null });
  }, [onFilterChange]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* School autocomplete */}
        <div className="relative">
          <label htmlFor="school-search" className="mb-2 block text-sm font-medium">
            Código CE
          </label>
          <Input
            id="school-search"
            type="text"
            placeholder="Buscar por código CE..."
            value={schoolQuery}
            onChange={e => {
              setSchoolQuery(e.target.value);
              setShowDropdown(true);
            }}
            onFocus={() => setShowDropdown(true)}
          />
          {showDropdown && schoolResults.length > 0 && (
            <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-input bg-background shadow-lg">
              {schoolResults.map(school => (
                <button
                  key={school.codigo_ce}
                  className="w-full px-4 py-2 text-left hover:bg-accent hover:text-accent-foreground"
                  onClick={() => handleSchoolSelect(school)}
                >
                  <div className="font-medium">{school.codigo_ce}</div>
                  <div className="text-sm text-muted-foreground">
                    {school.nombre_ce} - {school.municipio}, {school.departamento}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Grade selector */}
        <div>
          <label htmlFor="grade-select" className="mb-2 block text-sm font-medium">
            Grado
          </label>
          <Select
            id="grade-select"
            value={selectedGrade}
            onChange={e => handleGradeChange(e.target.value)}
            disabled={!selectedSchool || isLoadingGrades}
          >
            <option value="">
              {!selectedSchool
                ? 'Seleccione un código CE primero'
                : isLoadingGrades
                ? 'Cargando grados...'
                : 'Todos los grados'}
            </option>
            {grades.map(grade => (
              <option key={grade} value={grade}>
                {grade}
              </option>
            ))}
          </Select>
        </div>

        {/* Action buttons */}
        <div className="flex items-end gap-2">
          <Button onClick={onSearch} disabled={isSearching}>
            {isSearching ? 'Buscando...' : 'Buscar'}
          </Button>
          <Button variant="outline" onClick={handleClear}>
            Limpiar
          </Button>
        </div>
      </div>

      {/* Selected school info */}
      {selectedSchool && (
        <div className="text-sm text-muted-foreground">
          Código CE seleccionado: <span className="font-medium">{selectedSchool.codigo_ce}</span> -{' '}
          {selectedSchool.nombre_ce}
        </div>
      )}
    </div>
  );
}
