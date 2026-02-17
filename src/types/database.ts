// Database types matching the public schema
export type JobStatus = 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';
export type TaskStatus = 'pending' | 'running' | 'complete' | 'failed' | 'cancelled';

export interface School {
  codigo_ce: string;
  nombre_ce: string;
  departamento: string;
  municipio: string;
  distrito: string;
  direccion: string;
  zona: string;
}

export interface Student {
  nie: string;
  school_codigo_ce: string;
  nombre_estudiante: string;
  sexo: 'Hombre' | 'Mujer';
  edad: number | null;
  grado: string;
  grado_ok: string;
}

export interface UniformSize {
  nie: string;
  camisa: string;
  pantalon_falda: string;
  zapato: string;
}

export interface ReportJobBatch {
  id: string;
  status: string;
  shard_count: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  batch_params: Record<string, unknown> | null;
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
  batch_id?: string | null;
  shard_no?: number | null;
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
  grado_ok: string;
  school_codigo_ce: string;
  nombre_ce: string;
  departamento: string;
  distrito: string;
  zona: string;
  transporte: string;
  fecha_inicio: string;
  camisa: string;
  tipo_de_camisa: string;
  pantalon_falda: string;
  t_pantalon_falda_short: string;
  zapato: string;
  total_count: number;
}

export interface SchoolSearchResult {
  codigo_ce: string;
  nombre_ce: string;
  municipio: string;
  departamento: string;
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

export interface BatchProgress {
  batch_id: string;
  shard_count: number;
  total_tasks: number;
  pending_tasks: number;
  running_tasks: number;
  complete_tasks: number;
  failed_tasks: number;
  jobs_queued: number;
  jobs_running: number;
  jobs_complete: number;
  jobs_failed: number;
}

// Normalized demand pipeline types

/** A single demand row from school_demand joined with school name */
export interface DemandRow {
  school_codigo_ce: string;
  nombre_ce: string;
  departamento: string;
  distrito: string;
  item: string;       // 'CAJAS' | 'UNIFORMES' | 'ZAPATOS'
  tipo: string;       // 'CAJAS', 'CAMISA BLANCA', 'ZAPATOS', etc.
  categoria: string;  // grade name or size
  cantidad: number;
}

/** School group for demand-based reports (analogous to SchoolGroup for student-level) */
export interface SchoolDemandGroup {
  codigo_ce: string;
  nombre_ce: string;
  departamento: string;
  distrito: string;
  rows: DemandRow[];
}
