-- Migration: update_department_enum_5_depts
-- Replaces 6 old departments (technical, pr, social, design, event_management, research_and_development)
-- with the 5 correct ones (technical, pr, research_and_development, event_management, social_and_design)
--
-- PostgreSQL cannot ALTER ENUM to remove values directly.
-- Strategy: rename old enum, create new enum, update column, drop old enum.

-- Step 1: Rename old enum
ALTER TYPE "Department" RENAME TO "Department_old";

-- Step 2: Create new enum with correct 5 values
CREATE TYPE "Department" AS ENUM (
  'technical',
  'pr',
  'research_and_development',
  'event_management',
  'social_and_design'
);

-- Step 3: Migrate existing column data
--   - technical -> technical (unchanged)
--   - pr        -> pr        (unchanged)
--   - research_and_development -> research_and_development (unchanged)
--   - event_management -> event_management (unchanged)
--   - social    -> social_and_design  (merged)
--   - design    -> social_and_design  (merged)
ALTER TABLE "Member"
  ALTER COLUMN "department" DROP DEFAULT,
  ALTER COLUMN "department" TYPE "Department"
    USING CASE "department"::text
      WHEN 'social' THEN 'social_and_design'::"Department"
      WHEN 'design' THEN 'social_and_design'::"Department"
      ELSE "department"::text::"Department"
    END;

-- Step 4: Drop old enum
DROP TYPE "Department_old";
