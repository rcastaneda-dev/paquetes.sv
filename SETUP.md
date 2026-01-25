# Guía de Configuración Rápida

## Pre-requisitos

- Node.js 18+ instalado
- Cuenta de Supabase (gratis en supabase.com)
- Cuenta de Vercel (opcional, para deploy)

## Pasos de Configuración

### 1. Instalar dependencias

```bash
npm install
```

### 2. Configurar Supabase

#### Crear proyecto
1. Ve a https://supabase.com/dashboard
2. Crea un nuevo proyecto
3. Espera a que termine de configurarse (~2 minutos)

#### Obtener credenciales
En Settings > API:
- Copia la `URL` del proyecto
- Copia la `anon/public` key
- Copia la `service_role` key (¡mantenla secreta!)

#### Ejecutar migraciones SQL

En SQL Editor de Supabase, ejecuta estos scripts **en orden**:

**Script 1: Schema Base**
```sql
-- Pega el contenido completo de paquetes_schema.sql
```

**Script 2: Fix Foreign Keys** (si ya tenías datos)
```sql
-- Pega el contenido completo de fix_foreign_keys.sql
```

**Script 3: Infraestructura de Reportes**
```sql
-- Pega el contenido completo de supabase/migrations/001_add_reporting_tables.sql
```

#### Crear Storage Bucket

1. Ve a Storage en el dashboard
2. Crea un nuevo bucket llamado `reports`
3. En Settings del bucket, haz click en "New Policy"
4. Agrega estas políticas:

```sql
-- SELECT: Lectura pública
CREATE POLICY "Public read access" ON storage.objects
FOR SELECT USING (bucket_id = 'reports');

-- INSERT: Solo service role
CREATE POLICY "Service role write" ON storage.objects
FOR INSERT WITH CHECK (bucket_id = 'reports');

-- DELETE: Solo service role
CREATE POLICY "Service role delete" ON storage.objects
FOR DELETE USING (bucket_id = 'reports');
```

### 3. Configurar variables de entorno

```bash
cp .env.example .env
```

Edita `.env` con tus credenciales:

```env
NEXT_PUBLIC_SUPABASE_URL=https://tuproyecto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=tu_anon_key_aqui
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key_aqui

# Genera secrets seguros (ejecuta en terminal):
# openssl rand -base64 32
SUPABASE_FUNCTION_SECRET=un_secret_aleatorio_aqui
CRON_SECRET=otro_secret_aleatorio_aqui
```

### 4. Ejecutar en desarrollo

```bash
npm run dev
```

Abre http://localhost:3000

### 5. Probar funcionalidad

#### Test de consultas
1. Ve a la página principal
2. Busca una escuela
3. Selecciona un grado
4. Haz clic en "Buscar"

#### Test de reportes masivos
⚠️ **Nota**: Los workers (cron) no funcionan en desarrollo local.

Para probar localmente:
```bash
# Manualmente trigger el worker
curl -X POST http://localhost:3000/api/worker/process-tasks \
  -H "Authorization: Bearer tu_CRON_SECRET"
```

## Deploy a Producción

### Opción A: Vercel (Recomendado)

1. **Push a GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/tu-usuario/paquetes-sv.git
   git push -u origin main
   ```

2. **Deploy en Vercel**:
   - Ve a vercel.com
   - Click "Import Project"
   - Selecciona tu repo
   - Agrega las variables de entorno (las mismas del .env)
   - Deploy!

3. **Los cron jobs se activan automáticamente** gracias a `vercel.json`

### Opción B: Otro hosting

Si usas otro hosting (Railway, Render, etc.):

1. Deploy la app normalmente
2. Configura las variables de entorno
3. **Importante**: Los cron jobs definidos en `vercel.json` solo funcionan en Vercel
4. Alternativas:
   - Usa Supabase Edge Functions (ver README.md)
   - Configura cron jobs en tu servidor
   - Usa un servicio externo como cron-job.org

## Verificación

### Checklist de configuración

- [ ] Proyecto Next.js corre localmente
- [ ] Puedes buscar escuelas (autocomplete funciona)
- [ ] Puedes ver estudiantes en la tabla
- [ ] Storage bucket "reports" existe en Supabase
- [ ] Variables de entorno están configuradas
- [ ] Migraciones SQL ejecutadas correctamente

### Comandos útiles de verificación

```bash
# Verificar que las dependencias están OK
npm run type-check

# Verificar linter
npm run lint

# Probar build de producción
npm run build
npm start
```

### Verificar Supabase

En SQL Editor, ejecuta:

```sql
-- Verificar tablas de reportes
SELECT COUNT(*) FROM public.report_jobs;
SELECT COUNT(*) FROM public.report_tasks;

-- Verificar funciones RPC
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_type = 'FUNCTION';

-- Debería listar:
-- query_students
-- search_schools
-- get_grades
-- report_students_by_school_grade
-- get_school_grade_combinations
-- claim_pending_tasks
-- update_task_status
-- get_job_progress
```

### Nota sobre schemas

Este proyecto usa el schema **`public`** (default de Supabase) para tablas y funciones RPC. No necesitas exponer schemas adicionales en **Settings → API**.

## Problemas Comunes

### "Missing Supabase environment variables"

- Verifica que `.env` existe y tiene las 3 variables principales
- Reinicia el servidor de desarrollo

### "Failed to fetch schools"

- Verifica que las migraciones SQL se ejecutaron
- Revisa la consola del navegador para ver el error exacto
- Verifica que la URL de Supabase es correcta

### "Invalid schema" (PGRST106)

Esto ocurre si tu cliente intenta usar un schema no expuesto. En este proyecto, asegúrate de usar `public` (default) y no forzar `db.schema`.

### Storage "Failed to upload PDF"

- Verifica que el bucket `reports` existe
- Verifica las políticas de acceso
- Confirma que usas `SUPABASE_SERVICE_ROLE_KEY` (no la anon key)

### Cron no ejecuta

- **Local**: Los cron no funcionan en desarrollo, usa curl manual
- **Vercel**: Solo funciona en producción y en planes compatibles
- **Alternativa**: Usa Supabase Edge Functions

## Siguiente Paso

Una vez todo funcione, revisa el [README.md](./README.md) para:
- Entender la arquitectura completa
- Ver mejoras futuras
- Implementar autenticación
- Personalizar funcionalidades

## ¿Necesitas ayuda?

1. Revisa los logs en Supabase Dashboard > Logs
2. Revisa la consola del navegador (F12)
3. Revisa los logs del servidor Next.js
4. Crea un issue en el repositorio con detalles del error
