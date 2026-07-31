-- EMR fields displayed on the approved SSX Contact Card.
-- This migration is additive and preserves all existing company records.
ALTER TABLE ssx_companies ADD COLUMN emr_rating REAL;
ALTER TABLE ssx_companies ADD COLUMN emr_effective_date TEXT;
