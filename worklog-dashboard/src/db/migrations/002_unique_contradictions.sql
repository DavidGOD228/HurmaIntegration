-- Deduplicate contradictions: keep one row per (employee_id, contradiction_date, contradiction_type)
-- Then add unique constraint so duplicates cannot recur.

DELETE FROM contradictions a
USING contradictions b
WHERE a.employee_id = b.employee_id
  AND a.contradiction_date = b.contradiction_date
  AND a.contradiction_type = b.contradiction_type
  AND a.id < b.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_contradictions_employee_date_type
  ON contradictions(employee_id, contradiction_date, contradiction_type);
