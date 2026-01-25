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

export function FiltersPanel({ onFilterChange, onSearch }: FiltersPanelProps) {
  const [schoolQuery, setSchoolQuery] = useState('');
  const [schoolResults, setSchoolResults] = useState<SchoolSearchResult[]>([]);
  const [selectedSchool, setSelectedSchool] = useState<SchoolSearchResult | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [grades, setGrades] = useState<string[]>([]);
  const [selectedGrade, setSelectedGrade] = useState<string>('');
  const [isSearching, setIsSearching] = useState(false);

  // Fetch available grades on mount
  useEffect(() => {
    fetch('/api/grades')
      .then(res => res.json())
      .then(data => setGrades(data.grades || []))
      .catch(err => console.error('Error fetching grades:', err));
  }, []);

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

  const handleSchoolSelect = useCallback((school: SchoolSearchResult) => {
    setSelectedSchool(school);
    setSchoolQuery(school.nombre_ce);
    setShowDropdown(false);
    onFilterChange({
      school_codigo_ce: school.codigo_ce,
      grado: selectedGrade || null,
    });
  }, [selectedGrade, onFilterChange]);

  const handleGradeChange = useCallback((grade: string) => {
    setSelectedGrade(grade);
    onFilterChange({
      school_codigo_ce: selectedSchool?.codigo_ce || null,
      grado: grade || null,
    });
  }, [selectedSchool, onFilterChange]);

  const handleClear = useCallback(() => {
    setSchoolQuery('');
    setSelectedSchool(null);
    setSelectedGrade('');
    setSchoolResults([]);
    onFilterChange({ school_codigo_ce: null, grado: null });
  }, [onFilterChange]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* School autocomplete */}
        <div className="relative">
          <label htmlFor="school-search" className="block text-sm font-medium mb-2">
            Escuela
          </label>
          <Input
            id="school-search"
            type="text"
            placeholder="Buscar escuela..."
            value={schoolQuery}
            onChange={(e) => {
              setSchoolQuery(e.target.value);
              setShowDropdown(true);
            }}
            onFocus={() => setShowDropdown(true)}
          />
          {showDropdown && schoolResults.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-background border border-input rounded-md shadow-lg max-h-60 overflow-auto">
              {schoolResults.map((school) => (
                <button
                  key={school.codigo_ce}
                  className="w-full text-left px-4 py-2 hover:bg-accent hover:text-accent-foreground"
                  onClick={() => handleSchoolSelect(school)}
                >
                  <div className="font-medium">{school.nombre_ce}</div>
                  <div className="text-sm text-muted-foreground">
                    {school.municipio}, {school.departamento}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Grade selector */}
        <div>
          <label htmlFor="grade-select" className="block text-sm font-medium mb-2">
            Grado
          </label>
          <Select
            id="grade-select"
            value={selectedGrade}
            onChange={(e) => handleGradeChange(e.target.value)}
          >
            <option value="">Todos los grados</option>
            {grades.map((grade) => (
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
          Escuela seleccionada: <span className="font-medium">{selectedSchool.nombre_ce}</span> ({selectedSchool.codigo_ce})
        </div>
      )}
    </div>
  );
}
