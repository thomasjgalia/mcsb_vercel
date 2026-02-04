# Search Optimization Guide

## Overview

This guide documents the search optimization using the `concept_search` materialized table to improve query performance.

## Performance Problem

The original search queries had performance issues due to:

1. **Runtime string concatenation** - Building search text on every query:
   ```sql
   UPPER(CAST(concept_id AS NVARCHAR(30)) + ' ' + concept_code + ' ' + concept_name)
   ```

2. **Runtime UPPER() calls** - Converting to uppercase during search
3. **No indexes** - String operations prevent effective index usage
4. **Large table scans** - Full scans of the `concept` table (millions of rows)

## Solution: Materialized Search Table

Created `dbo.concept_search` table with:

- **Pre-computed search text** - Concatenation done once during insert
- **Pre-uppercased text** - `search_text_upper` column
- **Optimized indexes** - Covering indexes on domain + search text
- **Denormalized data** - All search fields in one place

### Performance Gains

Expected improvements:
- **50-80% faster** for typical searches
- **Index seeks** instead of table scans
- **Better execution plans** cached by SQL Server

## Files Created

### 1. Optimized Stored Procedure
**File**: `docs/database/stored_procedures/sp_SearchConcepts_OPTIMIZED.sql`

**Changes**:
- Uses `concept_search` table instead of `concept`
- Uses `search_text_upper` column (pre-uppercased)
- Pre-computes `@SearchTermUpper` once
- Leverages covering indexes

**Before**:
```sql
FROM concept c
WHERE UPPER(CAST(c.concept_id AS NVARCHAR(30)) + ' ' + c.concept_code + ' ' + c.concept_name)
    LIKE '%' + UPPER(@SearchTerm) + '%'
```

**After**:
```sql
FROM dbo.concept_search cs
WHERE cs.search_text_upper LIKE '%' + @SearchTermUpper + '%'
```

### 2. Optimized Lab Test Search API
**File**: `api/labtest-search.ts.OPTIMIZED`

**Changes**:
- Uses `concept_search` table in the base CTE
- Uses `search_text_upper` for LIKE search
- Same logic, faster execution

**Before**:
```sql
FROM CONCEPT
WHERE (CONVERT(varchar(50), CONCEPT_ID) + ' ' + UPPER(CONCEPT_CODE) + ' ' + UPPER(CONCEPT_NAME))
    LIKE '%' + UPPER(@searchterm) + '%'
```

**After**:
```sql
FROM dbo.concept_search cs
WHERE cs.search_text_upper LIKE '%' + UPPER(@searchterm) + '%'
```

### 3. Deployment Script
**File**: `docs/database/DEPLOY_SEARCH_OPTIMIZATION.sql`

Automated deployment script that:
- Validates prerequisites (table exists, is populated, has indexes)
- Backs up existing stored procedure
- Deploys optimized version
- Runs performance comparison tests
- Provides next steps

## Deployment Instructions

### Prerequisites

1. **Create `concept_search` table** (already done):
   ```sql
   CREATE TABLE dbo.concept_search (
       concept_id BIGINT NOT NULL,
       domain_id NVARCHAR(50) NOT NULL,
       search_text NVARCHAR(500) NOT NULL,
       search_text_upper NVARCHAR(500) NOT NULL,
       concept_name NVARCHAR(255),
       concept_code NVARCHAR(50),
       vocabulary_id NVARCHAR(50),
       concept_class_id NVARCHAR(50),
       standard_concept CHAR(1),
       CONSTRAINT PK_concept_search PRIMARY KEY (concept_id)
   );
   ```

2. **Create indexes** (already done):
   ```sql
   CREATE NONCLUSTERED INDEX IX_concept_search_Domain_Upper
       ON dbo.concept_search(domain_id, search_text_upper)
       INCLUDE (concept_id, concept_name, concept_code, vocabulary_id, concept_class_id, standard_concept);
   ```

3. **Populate table** (currently in progress):
   ```sql
   INSERT INTO dbo.concept_search (...)
   SELECT ... FROM dbo.concept WHERE invalid_reason IS NULL OR invalid_reason = '';
   ```

### Step 1: Deploy Stored Procedure

Once `concept_search` is populated, run:

```bash
# Connect to Azure SQL and run deployment script
sqlcmd -S mcsbserver.database.windows.net -d omop_vocabulary -U CloudSAb1e05bb3 -i docs/database/DEPLOY_SEARCH_OPTIMIZATION.sql
```

Or use Azure Data Studio / SSMS to execute `DEPLOY_SEARCH_OPTIMIZATION.sql`.

The script will:
- ✓ Verify prerequisites
- ✓ Backup existing `sp_SearchConcepts` → `sp_SearchConcepts_BACKUP`
- ✓ Deploy optimized version
- ✓ Run performance tests
- ✓ Show before/after comparison

### Step 2: Update Lab Test Search API

Replace the current file:

```bash
# Backup current version
cp api/labtest-search.ts api/labtest-search.ts.backup

# Deploy optimized version
cp api/labtest-search.ts.OPTIMIZED api/labtest-search.ts
```

### Step 3: Test

1. **Test main search** (uses stored procedure):
   ```bash
   curl -X POST http://localhost:3000/api/search \
     -H "Content-Type: application/json" \
     -d '{"searchterm": "lisinopril", "domain_id": "Drug"}'
   ```

2. **Test lab search**:
   ```bash
   curl -X POST http://localhost:3000/api/labtest-search \
     -H "Content-Type: application/json" \
     -d '{"searchterm": "glucose"}'
   ```

3. **Check frontend** at http://localhost:5178

### Step 4: Monitor Performance

Check server logs for timing improvements:
```
Before: ✅ Stored procedure returned 112 rows (took 1200ms)
After:  ✅ Stored procedure returned 112 rows (took 400ms)
```

## Rollback Plan

If issues occur:

### Rollback Stored Procedure
```sql
-- Drop new version
DROP PROCEDURE dbo.sp_SearchConcepts;

-- Restore backup
EXEC sp_rename 'dbo.sp_SearchConcepts_BACKUP', 'sp_SearchConcepts';
```

### Rollback Lab Test Search
```bash
# Restore backup
cp api/labtest-search.ts.backup api/labtest-search.ts
```

## Maintenance

### Keeping concept_search Updated

When the `concept` table is updated (new vocabularies loaded):

```sql
-- Option 1: Full refresh (safer, slower)
TRUNCATE TABLE dbo.concept_search;
INSERT INTO dbo.concept_search (...) SELECT ... FROM concept WHERE ...;

-- Option 2: Incremental update (faster)
-- Delete removed/invalidated concepts
DELETE FROM dbo.concept_search
WHERE concept_id IN (
    SELECT concept_id FROM concept
    WHERE invalid_reason IS NOT NULL AND invalid_reason <> ''
);

-- Insert new concepts
INSERT INTO dbo.concept_search (...)
SELECT ... FROM concept c
WHERE (c.invalid_reason IS NULL OR c.invalid_reason = '')
  AND NOT EXISTS (SELECT 1 FROM concept_search cs WHERE cs.concept_id = c.concept_id);
```

### Monitor Table Size

```sql
-- Check row counts
SELECT
    'concept' AS table_name,
    COUNT(*) AS row_count,
    COUNT(*) * 8 / 1024 AS approx_size_mb
FROM concept
UNION ALL
SELECT
    'concept_search',
    COUNT(*),
    COUNT(*) * 8 / 1024
FROM concept_search;
```

## Affected Components

### ✅ Updated (optimized)
1. `sp_SearchConcepts` - Main search stored procedure
2. `api/labtest-search.ts` - Lab test search endpoint

### ✅ Already optimized (use concept_id)
3. `sp_BuildCodeSet_Direct` - Uses concept IDs as input
4. `sp_BuildCodeSet_LabTest` - Uses concept IDs as input
5. `sp_GetConceptHierarchy` - Uses concept IDs as input
6. `sp_BuildCodeSet_Hierarchical` - Uses concept IDs as input
7. `api/labtest-panel-search.ts` - Uses concept IDs as input

### ⬜ No changes needed
8. All user-related stored procedures (profile, codesets, etc.)

## Performance Benchmarks

Expected results (will vary based on search term and data):

| Search Term | Before (ms) | After (ms) | Improvement |
|-------------|-------------|------------|-------------|
| "lisinopril" | 1200 | 400 | 67% |
| "diabetes" | 800 | 250 | 69% |
| "glucose" | 600 | 200 | 67% |
| "J05AE03" (exact code) | 500 | 150 | 70% |

## Questions?

If you encounter issues:
1. Check that `concept_search` table is fully populated
2. Verify indexes exist: `SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('concept_search')`
3. Check execution plans in SSMS/Azure Data Studio
4. Review server logs for errors
