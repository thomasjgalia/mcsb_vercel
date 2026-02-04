-- ============================================================================
-- DEPLOYMENT SCRIPT: Search Optimization with concept_search Table
-- ============================================================================
-- This script deploys the optimized search stored procedure
-- Prerequisites:
--   1. concept_search table must be created
--   2. concept_search table must be populated
--   3. Indexes on concept_search must exist
-- ============================================================================

USE [omop_vocabulary];
GO

-- ============================================================================
-- STEP 1: Verify concept_search table exists and is populated
-- ============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'concept_search')
BEGIN
    RAISERROR('ERROR: concept_search table does not exist. Please create it first.', 16, 1);
    RETURN;
END

DECLARE @RowCount INT;
SELECT @RowCount = COUNT(*) FROM dbo.concept_search;

IF @RowCount = 0
BEGIN
    RAISERROR('ERROR: concept_search table is empty. Please populate it first.', 16, 1);
    RETURN;
END

PRINT '✓ concept_search table exists with ' + CAST(@RowCount AS VARCHAR(20)) + ' rows';

-- ============================================================================
-- STEP 2: Verify required indexes exist
-- ============================================================================
IF NOT EXISTS (
    SELECT * FROM sys.indexes
    WHERE name = 'IX_concept_search_Domain_Upper'
    AND object_id = OBJECT_ID('dbo.concept_search')
)
BEGIN
    RAISERROR('ERROR: Required index IX_concept_search_Domain_Upper is missing.', 16, 1);
    RETURN;
END

PRINT '✓ Required indexes exist';

-- ============================================================================
-- STEP 3: Backup existing stored procedure (just in case)
-- ============================================================================
IF EXISTS (SELECT * FROM sys.objects WHERE type = 'P' AND name = 'sp_SearchConcepts_BACKUP')
BEGIN
    DROP PROCEDURE dbo.sp_SearchConcepts_BACKUP;
    PRINT '✓ Dropped old backup procedure';
END

IF EXISTS (SELECT * FROM sys.objects WHERE type = 'P' AND name = 'sp_SearchConcepts')
BEGIN
    -- Create backup by renaming
    EXEC sp_rename 'dbo.sp_SearchConcepts', 'sp_SearchConcepts_BACKUP';
    PRINT '✓ Backed up existing sp_SearchConcepts to sp_SearchConcepts_BACKUP';
END
GO

-- ============================================================================
-- STEP 4: Deploy optimized stored procedure
-- ============================================================================
CREATE PROCEDURE dbo.sp_SearchConcepts
    @SearchTerm NVARCHAR(255),
    @DomainId NVARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    -- Validate input
    IF LEN(LTRIM(RTRIM(@SearchTerm))) < 2
    BEGIN
        RAISERROR('Search term must be at least 2 characters', 16, 1);
        RETURN;
    END

    IF @DomainId IS NULL OR @DomainId = ''
    BEGIN
        RAISERROR('Domain ID is required', 16, 1);
        RETURN;
    END;

    -- OPTIMIZATION: Pre-uppercase the search term once
    DECLARE @SearchTermUpper NVARCHAR(255) = UPPER(@SearchTerm);

    -- Use concept_search table with pre-computed search_text_upper
    WITH hits AS (
        SELECT
            cs.concept_id,
            cs.concept_name,
            cs.concept_code,
            cs.vocabulary_id,
            cs.domain_id,
            cs.concept_class_id,
            cs.standard_concept,
            -- Match flags for ranking
            CASE WHEN TRY_CAST(@SearchTerm AS BIGINT) = cs.concept_id THEN 1 ELSE 0 END AS is_exact_id_match,
            CASE WHEN cs.concept_code = @SearchTerm THEN 1 ELSE 0 END AS is_exact_code_match,
            ABS(LEN(@SearchTerm) - LEN(cs.concept_name)) AS name_length_delta
        FROM dbo.concept_search cs
        WHERE
            -- OPTIMIZED: Use pre-uppercased search text with covering index
            cs.search_text_upper LIKE '%' + @SearchTermUpper + '%'
            AND cs.domain_id = @DomainId
            AND (
                -- Domain-specific vocabulary filtering
                (@DomainId = 'Condition' AND cs.vocabulary_id IN ('ICD10CM','SNOMED','ICD9CM'))
                OR (@DomainId = 'Observation' AND cs.vocabulary_id IN ('ICD10CM','SNOMED','LOINC','CPT4','HCPCS'))
                OR (@DomainId = 'Drug' AND cs.vocabulary_id IN ('RxNorm','NDC','CPT4','CVX','HCPCS','ATC'))
                OR (@DomainId = 'Measurement' AND cs.vocabulary_id IN ('LOINC','CPT4','SNOMED','HCPCS'))
                OR (@DomainId = 'Procedure' AND cs.vocabulary_id IN ('CPT4','HCPCS','SNOMED','ICD09PCS','LOINC','ICD10PCS'))
            )
            AND (
                cs.domain_id <> 'Drug'
                OR cs.concept_class_id IN (
                    'Clinical Drug','Branded Drug','Ingredient','Clinical Pack','Branded Pack',
                    'Quant Clinical Drug','Quant Branded Drug','11-digit NDC',
                    -- ATC classification levels
                    'ATC 1st','ATC 2nd','ATC 3rd','ATC 4th','ATC 5th'
                )
                OR cs.vocabulary_id = 'ATC'
            )
    ),
    mapped AS (
        -- Optional mapping to standard concepts (prefer when available)
        SELECT
            h.*,
            cr.relationship_id,
            s.concept_id       AS s_concept_id,
            s.concept_name     AS s_concept_name,
            s.concept_code     AS s_concept_code,
            s.vocabulary_id    AS s_vocabulary_id,
            s.concept_class_id AS s_concept_class_id,
            s.standard_concept AS s_standard_concept
        FROM hits h
        LEFT JOIN concept_relationship cr
            ON cr.concept_id_1 = h.concept_id
            AND cr.relationship_id = 'Maps to'
        LEFT JOIN concept s
            ON s.concept_id = cr.concept_id_2
            AND s.standard_concept = 'S'
    )
    SELECT TOP 1000
        -- Prefer mapped standard target if present; otherwise use searched concept
        COALESCE(
            s_concept_name,
            CASE WHEN standard_concept = 'S' THEN concept_name END,
            concept_name
        ) AS standard_name,

        COALESCE(
            s_concept_id,
            CASE WHEN standard_concept = 'S' THEN concept_id END,
            concept_id
        ) AS std_concept_id,

        COALESCE(
            s_concept_code,
            CASE WHEN standard_concept = 'S' THEN concept_code END,
            concept_code
        ) AS standard_code,

        COALESCE(
            s_vocabulary_id,
            CASE WHEN standard_concept = 'S' THEN vocabulary_id END,
            vocabulary_id
        ) AS standard_vocabulary,

        COALESCE(
            s_concept_class_id,
            CASE WHEN standard_concept = 'S' THEN concept_class_id END,
            concept_class_id
        ) AS concept_class_id,

        -- Echo the searched concept context
        concept_name         AS search_result,
        concept_id           AS searched_concept_id,
        concept_code         AS searched_code,
        vocabulary_id        AS searched_vocabulary,
        concept_class_id     AS searched_concept_class_id,
        CAST(concept_id AS NVARCHAR(30)) + ' ' + concept_code + ' ' + concept_name AS searched_term
    FROM mapped
    ORDER BY
        -- 1) Exact ID matches first
        CASE WHEN is_exact_id_match = 1 THEN 0 ELSE 1 END,
        -- 2) Exact code matches next
        CASE WHEN is_exact_code_match = 1 THEN 0 ELSE 1 END,
        -- 3) Prefer mapped standard targets over unmapped originals
        CASE
            WHEN s_concept_id IS NOT NULL THEN 0  -- Mapped standard exists
            WHEN standard_concept = 'S'    THEN 1  -- Already standard
            ELSE 2  -- Unmapped original (e.g., ATC classification)
        END,
        -- 4) Name proximity
        name_length_delta,
        concept_name;
END;
GO

PRINT '✓ Deployed optimized sp_SearchConcepts';

-- ============================================================================
-- STEP 5: Test the optimized stored procedure
-- ============================================================================
PRINT '';
PRINT '=== Testing optimized stored procedure ===';

DECLARE @TestStart DATETIME2 = SYSDATETIME();
EXEC dbo.sp_SearchConcepts @SearchTerm = 'lisinopril', @DomainId = 'Drug';
DECLARE @TestEnd DATETIME2 = SYSDATETIME();
DECLARE @DurationMs INT = DATEDIFF(MILLISECOND, @TestStart, @TestEnd);

PRINT '✓ Test query completed in ' + CAST(@DurationMs AS VARCHAR(10)) + 'ms';

-- ============================================================================
-- STEP 6: Compare performance (if backup exists)
-- ============================================================================
IF EXISTS (SELECT * FROM sys.objects WHERE type = 'P' AND name = 'sp_SearchConcepts_BACKUP')
BEGIN
    PRINT '';
    PRINT '=== Testing OLD version for comparison ===';

    DECLARE @OldStart DATETIME2 = SYSDATETIME();
    EXEC dbo.sp_SearchConcepts_BACKUP @SearchTerm = 'lisinopril', @DomainId = 'Drug';
    DECLARE @OldEnd DATETIME2 = SYSDATETIME();
    DECLARE @OldDurationMs INT = DATEDIFF(MILLISECOND, @OldStart, @OldEnd);

    PRINT '✓ OLD version completed in ' + CAST(@OldDurationMs AS VARCHAR(10)) + 'ms';

    IF @DurationMs < @OldDurationMs
    BEGIN
        DECLARE @Improvement DECIMAL(5,1) = (CAST(@OldDurationMs - @DurationMs AS DECIMAL(10,2)) / @OldDurationMs) * 100;
        PRINT '✓ Performance improvement: ' + CAST(@Improvement AS VARCHAR(10)) + '%';
    END
END

PRINT '';
PRINT '=== Deployment Complete ===';
PRINT 'Next steps:';
PRINT '1. Update api/labtest-search.ts with optimized version';
PRINT '2. Test frontend search functionality';
PRINT '3. If satisfied, you can drop sp_SearchConcepts_BACKUP';
