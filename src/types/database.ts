// Database types matching the public schema
export type JobStatus = 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';
export type TaskStatus = 'pending' | 'running' | 'complete' | 'failed' | 'cancelled';

export interface School {
  codigo_ce: string;
  nombre_ce: string;
  departamento: string;
  region: string;
  ruta: string;
  municipio: string;
  distrito: string;
  direccion: string;
  zona: string;
  latitud: number | null;
  longitud: number | null;
}

export interface Student {
  nie: string;
  school_codigo_ce: string;
  nombre_estudiante: string;
  sexo: 'Hombre' | 'Mujer';
  edad: number | null;
  grado: string;
  grado_ok: string;
  bodega_produccion: string;
}

export interface UniformSize {
  nie: string;
  camisa: string;
  pantalon_falda: string;
  zapato: string;
}

export interface ReportJob {
  id: string;
  status: JobStatus;
  created_at: string;
  created_by: string | null;
  zip_path: string | null;
  error: string | null;
  job_params: Record<string, unknown> | null;
  updated_at: string;
}

export interface ReportTask {
  id: string;
  job_id: string;
  school_codigo_ce: string;
  grado: string;
  status: TaskStatus;
  attempt_count: number;
  pdf_path: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

// RPC response types
export interface StudentReportRow {
  nie: string;
  nombre_estudiante: string;
  sexo: string;
  edad: number | null;
  grado: string;
  camisa: string;
  pantalon_falda: string;
  zapato: string;
}

export interface StudentQueryRow {
  nie: string;
  nombre_estudiante: string;
  sexo: string;
  edad: number | null;
  grado: string;
  school_codigo_ce: string;
  nombre_ce: string;
  camisa: string;
  pantalon_falda: string;
  zapato: string;
  total_count: number;
}

export interface SchoolSearchResult {
  codigo_ce: string;
  nombre_ce: string;
  municipio: string;
  departamento: string;
}

export interface SchoolGradeCombination {
  school_codigo_ce: string;
  nombre_ce: string;
  grado: string;
  student_count: number;
}

export interface ClaimedTask {
  task_id: string;
  job_id: string;
  school_codigo_ce: string;
  grado: string;
}

export interface JobProgress {
  total_tasks: number;
  pending_tasks: number;
  running_tasks: number;
  complete_tasks: number;
  failed_tasks: number;
  cancelled_tasks: number;
}

// Query filters
export interface StudentFilters {
  school_codigo_ce?: string | null;
  grado?: string | null;
  limit?: number;
  offset?: number;
}
