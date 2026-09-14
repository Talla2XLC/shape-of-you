CREATE TYPE "public"."evidence_purpose" AS ENUM('person_context', 'operational_verification');--> statement-breakpoint
ALTER TABLE "source_references" ADD COLUMN "evidence_purpose" "evidence_purpose" DEFAULT 'person_context' NOT NULL;--> statement-breakpoint
DO $$
DECLARE
  invalid_person_count integer;
BEGIN
  SELECT count(*)
    INTO invalid_person_count
    FROM (
      SELECT "person_id"
        FROM "source_references"
       WHERE "external_system" = 'shape-of-you-staging-canary'
       GROUP BY "person_id"
      HAVING count(*) <> 12
          OR count(DISTINCT "external_record_id") <> 12
          OR bool_or("external_record_id" NOT IN (
            'TASK-0063:body:correct',
            'TASK-0063:body:record',
            'TASK-0063:meal:correct',
            'TASK-0063:meal:record',
            'TASK-0063:note:correct',
            'TASK-0063:note:record',
            'TASK-0063:recovery:correct',
            'TASK-0063:recovery:record',
            'TASK-0063:weight:correct',
            'TASK-0063:weight:record',
            'TASK-0063:workout:correct:v2',
            'TASK-0063:workout:record:v2'
          ))
    ) invalid_persons;

  IF invalid_person_count > 0 THEN
    RAISE EXCEPTION
      'TASK-0063 operational evidence backfill found an incomplete or unexpected marker set for % Person(s)',
      invalid_person_count;
  END IF;
END $$;--> statement-breakpoint
UPDATE "source_references"
   SET "evidence_purpose" = 'operational_verification'
 WHERE "external_system" = 'shape-of-you-staging-canary'
   AND "external_record_id" IN (
     'TASK-0063:body:correct',
     'TASK-0063:body:record',
     'TASK-0063:meal:correct',
     'TASK-0063:meal:record',
     'TASK-0063:note:correct',
     'TASK-0063:note:record',
     'TASK-0063:recovery:correct',
     'TASK-0063:recovery:record',
     'TASK-0063:weight:correct',
     'TASK-0063:weight:record',
     'TASK-0063:workout:correct:v2',
     'TASK-0063:workout:record:v2'
   );
