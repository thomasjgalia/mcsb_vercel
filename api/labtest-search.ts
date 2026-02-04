// ============================================================================
// API Endpoint: Lab Test Search (Measurement Domain) - OPTIMIZED
// ============================================================================
// Vercel Serverless Function
// Endpoint: POST /api/labtest-search
// OPTIMIZATION: Uses concept_search table with pre-computed search text
// ROLLUPS: Applies attribute rollups from JSON files (loaded once per instance)
// ============================================================================
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  executeQuery,
  createErrorResponse,
} from './lib/azuresql.js';

interface LabTestSearchRequest {
  searchterm: string;
}

interface LabTestSearchResult {
  lab_test_type: string;
  std_concept_id: number;
  search_result: string;
  searched_code: string;
  searched_concept_class_id: string;
  vocabulary_id: string;
  property: string | null;
  scale: string | null;
  system: string | null;
  time: string | null;
  panel_count: number;
}

// ============================================================================
// Load rollup mappings (cached per serverless instance)
// ============================================================================
interface ScaleRollup {
  attribute: string;
  raw_value: string;
  canonical: string;
  label: string;
}

interface TimeRollup {
  attribute: string;
  raw_value: string;
  time_bucket: string;
}

interface SystemRollup {
  attribute: string;
  raw_value: string;
  canonical: string;
  label: string;
}

let scaleRollups: ScaleRollup[] | null = null;
let timeRollups: TimeRollup[] | null = null;
let systemRollups: SystemRollup[] | null = null;

function loadRollups() {
  if (scaleRollups && timeRollups && systemRollups) {
    return; // Already loaded
  }

  try {
    const basePath = join(process.cwd(), 'SQL_Files', 'lab_attribute_rollups');

    scaleRollups = JSON.parse(
      readFileSync(join(basePath, 'rollup_scale_type.json'), 'utf-8')
    );

    timeRollups = JSON.parse(
      readFileSync(join(basePath, 'rollup_time_aspect.json'), 'utf-8')
    );

    systemRollups = JSON.parse(
      readFileSync(join(basePath, 'rollup_system.json'), 'utf-8')
    );

    console.log('✓ Loaded lab attribute rollups:', {
      scale: scaleRollups?.length,
      time: timeRollups?.length,
      system: systemRollups?.length
    });
  } catch (error) {
    console.error('Failed to load rollup files:', error);
    // Set to empty arrays to prevent retry
    scaleRollups = [];
    timeRollups = [];
    systemRollups = [];
  }
}

// Apply rollups to a single result
function applyRollups(result: LabTestSearchResult): LabTestSearchResult {
  return {
    ...result,
    scale: result.scale
      ? scaleRollups?.find(r => r.raw_value === result.scale)?.label || result.scale
      : result.scale,
    time: result.time
      ? timeRollups?.find(r => r.raw_value === result.time)?.time_bucket || result.time
      : result.time,
    system: result.system
      ? systemRollups?.find(r => r.raw_value === result.system)?.label || result.system
      : result.system,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('=== Lab Test Search API called ===');
  console.log('Method:', req.method);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json(createErrorResponse('Method not allowed', 405));
  }

  try {
    // Load rollup mappings (cached after first load)
    loadRollups();

    const { searchterm } = req.body as LabTestSearchRequest;
    console.log('Lab Test Search params:', { searchterm });

    // Validate input - allow empty searchterm for full list
    const searchValue = searchterm?.trim() || '';

    // OPTIMIZED: Build the SQL query using concept_search table
    const sql = `
      WITH base AS (
        -- OPTIMIZED: Use concept_search with pre-computed search_text_upper
        SELECT
          cs.concept_id AS std_concept_id,
          cs.concept_name AS CONCEPT_NAME,
          cs.concept_code AS CONCEPT_CODE,
          cs.concept_class_id AS CONCEPT_CLASS_ID,
          cs.vocabulary_id AS VOCABULARY_ID
        FROM dbo.concept_search cs
        WHERE cs.domain_id = 'Measurement'
          AND cs.vocabulary_id IN ('LOINC', 'CPT4', 'HCPCS', 'SNOMED')
          AND (
            (cs.vocabulary_id = 'LOINC' AND cs.concept_class_id = 'Lab Test')
            OR cs.vocabulary_id = 'CPT4'
            OR cs.vocabulary_id = 'SNOMED'
            OR (cs.vocabulary_id = 'HCPCS' AND cs.concept_class_id = 'HCPCS')
          )
          AND cs.search_text_upper LIKE '%' + UPPER(@searchterm) + '%'
      ),
      prop AS (
        SELECT CONCEPT_ID_1 std_concept_id, CONCEPT_ID_2
        FROM CONCEPT_RELATIONSHIP JOIN base ON base.std_concept_id = CONCEPT_ID_1
        WHERE RELATIONSHIP_ID = 'Has property'
      ),
      scale AS (
        SELECT CONCEPT_ID_1 std_concept_id, CONCEPT_ID_2
        FROM CONCEPT_RELATIONSHIP JOIN base ON base.std_concept_id = CONCEPT_ID_1
        WHERE RELATIONSHIP_ID = 'Has scale type'
      ),
      sys AS (
        SELECT CONCEPT_ID_1 std_concept_id, CONCEPT_ID_2
        FROM CONCEPT_RELATIONSHIP JOIN base ON base.std_concept_id = CONCEPT_ID_1
        WHERE RELATIONSHIP_ID = 'Has system'
      ),
      tm AS (
        SELECT CONCEPT_ID_1 std_concept_id, CONCEPT_ID_2
        FROM CONCEPT_RELATIONSHIP JOIN base ON base.std_concept_id = CONCEPT_ID_1
        WHERE RELATIONSHIP_ID = 'Has time aspect'
      ),
      panels AS (
        -- Count how many panels contain each lab test
        SELECT
          b.std_concept_id,
          COUNT(*) AS panel_count
        FROM base b
        INNER JOIN CONCEPT_RELATIONSHIP cr
          ON cr.CONCEPT_ID_2 = b.std_concept_id
          AND cr.RELATIONSHIP_ID = 'Contained in panel'
          AND COALESCE(cr.INVALID_REASON, '') = ''
        GROUP BY b.std_concept_id
      ),
      term_raw AS (
        SELECT
          'Lab Test' AS lab_test_type,
          b.std_concept_id    AS std_concept_id,
          b.CONCEPT_NAME      AS search_result,
          b.CONCEPT_CODE      AS searched_code,
          b.CONCEPT_CLASS_ID  AS searched_concept_class_id,
          b.VOCABULARY_ID     AS vocabulary_id,
          p_c.CONCEPT_NAME    AS property,
          sc_c.CONCEPT_NAME   AS scale,
          sy_c.CONCEPT_NAME   AS system,
          t_c.CONCEPT_NAME    AS time,
          COALESCE(pn.panel_count, 0) AS panel_count
        FROM base b
        LEFT JOIN prop p ON p.std_concept_id = b.std_concept_id
        LEFT JOIN CONCEPT p_c ON p_c.CONCEPT_ID = p.CONCEPT_ID_2 AND COALESCE(p_c.INVALID_REASON,'') = ''
        LEFT JOIN scale s ON s.std_concept_id = b.std_concept_id
        LEFT JOIN CONCEPT sc_c ON sc_c.CONCEPT_ID = s.CONCEPT_ID_2 AND COALESCE(sc_c.INVALID_REASON,'') = ''
        LEFT JOIN sys sy ON sy.std_concept_id = b.std_concept_id
        LEFT JOIN CONCEPT sy_c ON sy_c.CONCEPT_ID = sy.CONCEPT_ID_2 AND COALESCE(sy_c.INVALID_REASON,'') = ''
        LEFT JOIN tm t ON t.std_concept_id = b.std_concept_id
        LEFT JOIN CONCEPT t_c ON t_c.CONCEPT_ID = t.CONCEPT_ID_2 AND COALESCE(t_c.INVALID_REASON,'') = ''
        LEFT JOIN panels pn ON pn.std_concept_id = b.std_concept_id
      ),
      term AS (
        SELECT
          lab_test_type,
          std_concept_id,
          search_result,
          searched_code,
          searched_concept_class_id,
          vocabulary_id,
          -- Use NULLIF to convert empty strings to NULL
          NULLIF(STRING_AGG(CASE WHEN property IS NOT NULL THEN property END, ', '), '') AS property,
          NULLIF(STRING_AGG(CASE WHEN scale IS NOT NULL THEN scale END, ', '), '') AS scale,
          NULLIF(STRING_AGG(CASE WHEN system IS NOT NULL THEN system END, ', '), '') AS system,
          NULLIF(STRING_AGG(CASE WHEN time IS NOT NULL THEN time END, ', '), '') AS time,
          MAX(panel_count) AS panel_count
        FROM term_raw
        GROUP BY
          lab_test_type,
          std_concept_id,
          search_result,
          searched_code,
          searched_concept_class_id,
          vocabulary_id
      )
      SELECT * FROM term
      ORDER BY vocabulary_id, std_concept_id ASC
    `;

    // Execute query
    const results = await executeQuery<LabTestSearchResult>(sql, {
      searchterm: searchValue,
    });

    // Apply rollups to transform raw attribute values
    const rolledUpResults = results.map(applyRollups);

    console.log('📤 Sending lab test search response with', rolledUpResults.length, 'results (with rollups applied)');
    return res.status(200).json({
      success: true,
      data: rolledUpResults,
    });
  } catch (error) {
    console.error('Lab Test Search API error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
}
